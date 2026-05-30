import re
from datetime import datetime

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, EmailStr
from sqlmodel import Session as DbSession
from sqlmodel import select

from .. import ws_tickets
from ..config import settings
from ..deps import CurrentUser, Db
from ..models import Org, OrgMembership, OrgRole, Session, User
from ..models._time import utcnow
from ..security import hash_password, new_session_token, session_expiry, verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class SignupIn(BaseModel):
    email: EmailStr
    password: str
    name: str | None = None
    org_name: str | None = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str | None


class OrgOut(BaseModel):
    id: str
    name: str
    slug: str


class MeOut(BaseModel):
    user: UserOut
    org: OrgOut


_slug_re = re.compile(r"[^a-z0-9]+")


def _slugify(value: str) -> str:
    return _slug_re.sub("-", value.lower()).strip("-") or "org"


def _unique_slug(db: DbSession, base: str) -> str:
    slug = base
    n = 1
    while db.exec(select(Org).where(Org.slug == slug)).first():
        n += 1
        slug = f"{base}-{n}"
    return slug


def _default_org_name(name: str | None, email: str) -> str:
    if name:
        return f"{name}'s Workspace"
    return f"{email.split('@')[0]}'s Workspace"


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        httponly=True,
        samesite="lax",
        secure=False,  # flip to True behind HTTPS in prod
        max_age=settings.session_lifetime_days * 24 * 3600,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name, path="/")


def _start_session(db: DbSession, response: Response, user: User) -> None:
    token = new_session_token()
    db.add(Session(token=token, user_id=user.id, expires_at=session_expiry()))
    db.commit()
    _set_session_cookie(response, token)


def _resolve_org(db: DbSession, user: User) -> Org:
    membership = db.exec(
        select(OrgMembership).where(OrgMembership.user_id == user.id)
    ).first()
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "user has no org")
    org = db.get(Org, membership.org_id)
    if org is None:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "org missing for membership")
    return org


def _me(user: User, org: Org) -> MeOut:
    return MeOut(
        user=UserOut(id=user.id, email=user.email, name=user.name),
        org=OrgOut(id=org.id, name=org.name, slug=org.slug),
    )


@router.post("/signup", response_model=MeOut, status_code=status.HTTP_201_CREATED)
def signup(body: SignupIn, response: Response, db: Db) -> MeOut:
    email = body.email.lower().strip()
    if db.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")

    user = User(email=email, password_hash=hash_password(body.password), name=body.name)
    db.add(user)

    org_name = body.org_name or _default_org_name(body.name, email)
    org = Org(name=org_name, slug=_unique_slug(db, _slugify(org_name)))
    db.add(org)

    db.add(OrgMembership(user_id=user.id, org_id=org.id, role=OrgRole.owner))
    _start_session(db, response, user)
    return _me(user, org)


@router.post("/login", response_model=MeOut)
def login(body: LoginIn, response: Response, db: Db) -> MeOut:
    email = body.email.lower().strip()
    user = db.exec(select(User).where(User.email == email)).first()
    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid credentials")

    org = _resolve_org(db, user)
    _start_session(db, response, user)
    return _me(user, org)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, db: Db, user: CurrentUser) -> Response:
    for s in db.exec(select(Session).where(Session.user_id == user.id)).all():
        if s.expires_at >= utcnow():
            db.delete(s)
    db.commit()
    _clear_session_cookie(response)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/me", response_model=MeOut)
def me(db: Db, user: CurrentUser) -> MeOut:
    return _me(user, _resolve_org(db, user))


class WSTicketOut(BaseModel):
    ticket: str


@router.post("/ws-ticket", response_model=WSTicketOut)
def ws_ticket(user: CurrentUser) -> WSTicketOut:
    """Mint a one-shot, short-lived ticket for WebSocket auth.

    The dashboard calls this via HTTP (which carries the session cookie),
    then appends the ticket to a WS URL as ?ticket=… since the SameSite=Lax
    cookie won't ride along on a cross-origin WS upgrade.
    """
    return WSTicketOut(ticket=ws_tickets.issue(user.id))


class CLITokenOut(BaseModel):
    token: str
    expires_at: datetime


@router.post("/cli-token", response_model=CLITokenOut, status_code=status.HTTP_201_CREATED)
def cli_token(db: Db, user: CurrentUser) -> CLITokenOut:
    """Mint a session token that a CLI tool can send as `Authorization: Bearer`.

    Authenticated via the dashboard session (cookie). The returned token has
    the same TTL as a browser session and is stored in the same Session table,
    so `/auth/logout` revokes both at once.
    """
    token = new_session_token()
    expires_at = session_expiry()
    db.add(Session(token=token, user_id=user.id, expires_at=expires_at))
    db.commit()
    return CLITokenOut(token=token, expires_at=expires_at)
