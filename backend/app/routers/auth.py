import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from pydantic import BaseModel, EmailStr, Field
from sqlmodel import Session, select

from ..auth import AuthContext, clear_session_cookie, create_session, current_auth_context, hash_token, ph, utc_now
from ..config import settings
from ..db import get_session
from ..models import ApiToken, AuthSession, LocalCredential, Organization, OrganizationMembership, User, UserIdentity

router = APIRouter(prefix="/auth", tags=["auth"])


class AuthInput(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=1024)


class SignupInput(AuthInput):
    organization_name: str | None = Field(default=None, max_length=120)


class UserOut(BaseModel):
    id: str
    email: EmailStr


class OrganizationOut(BaseModel):
    id: str
    name: str


class AuthOut(BaseModel):
    user: UserOut
    organization: OrganizationOut


class CliAuthOut(AuthOut):
    token: str
    expires_at: str


def auth_out(user: User, org: Organization) -> AuthOut:
    return AuthOut(user=UserOut(id=user.id, email=user.email), organization=OrganizationOut(id=org.id, name=org.name))


@router.post("/signup", status_code=201)
def signup(body: SignupInput, response: Response, db: Session = Depends(get_session)) -> AuthOut:
    # For now, signing up will sign up for both user and org at same time no matter what, later we'll add seperation
    email = body.email.lower()
    if db.exec(select(User).where(User.email == email)).first():
        raise HTTPException(status.HTTP_409_CONFLICT, "email already registered")
    user = User(email=email)
    org = Organization(name=body.organization_name or f"{email.split('@', 1)[0]}'s organization")
    db.add(user)
    db.add(org)
    db.commit()
    db.refresh(user)
    db.refresh(org)
    db.add(OrganizationMembership(user_id=user.id, organization_id=org.id))
    db.add(LocalCredential(user_id=user.id, password_hash=ph.hash(body.password)))
    db.add(UserIdentity(user_id=user.id, provider="local", subject=email))
    db.commit()
    create_session(db, response, user.id)
    return auth_out(user, org)


@router.post("/login")
def login(body: AuthInput, response: Response, db: Session = Depends(get_session)) -> AuthOut:
    email = body.email.lower()
    user = db.exec(select(User).where(User.email == email)).first()
    credential = db.get(LocalCredential, user.id) if user else None
    if credential is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    try:
        ok = ph.verify(credential.password_hash, body.password)
        if ok and ph.check_needs_rehash(credential.password_hash):
            credential.password_hash = ph.hash(body.password)
            db.add(credential)
            db.commit()
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")

    membership = db.exec(select(OrganizationMembership).where(OrganizationMembership.user_id == user.id)).first()
    org = db.get(Organization, membership.organization_id) if membership else None
    if org is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid account")
    create_session(db, response, user.id)
    return auth_out(user, org)


@router.post("/cli/login")
def cli_login(body: AuthInput, db: Session = Depends(get_session)) -> CliAuthOut:
    email = body.email.lower()
    user = db.exec(select(User).where(User.email == email)).first()
    credential = db.get(LocalCredential, user.id) if user else None
    if credential is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")
    try:
        ok = ph.verify(credential.password_hash, body.password)
        if ok and ph.check_needs_rehash(credential.password_hash):
            credential.password_hash = ph.hash(body.password)
            db.add(credential)
            db.commit()
    except Exception:
        ok = False
    if not ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid email or password")

    membership = db.exec(select(OrganizationMembership).where(OrganizationMembership.user_id == user.id)).first()
    org = db.get(Organization, membership.organization_id) if membership else None
    if org is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid account")
    token = secrets.token_urlsafe(32)
    expires_at = utc_now() + timedelta(days=settings.cli_token_days)
    db.add(ApiToken(user_id=user.id, token_hash=hash_token(token), name="Cider CLI", expires_at=expires_at))
    db.commit()
    result = auth_out(user, org)
    return CliAuthOut(**result.model_dump(), token=token, expires_at=expires_at.isoformat() + "Z")


@router.post("/logout", status_code=204)
def logout(
    response: Response,
    cider_session: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
    db: Session = Depends(get_session),
) -> None:
    if cider_session:
        session = db.exec(select(AuthSession).where(AuthSession.token_hash == hash_token(cider_session))).first()
        if session:
            db.delete(session)
            db.commit()
    clear_session_cookie(response)


@router.get("/me")
def me(ctx: AuthContext = Depends(current_auth_context), db: Session = Depends(get_session)) -> AuthOut:
    org = db.get(Organization, ctx.membership.organization_id)
    if org is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid account")
    return auth_out(ctx.user, org)
