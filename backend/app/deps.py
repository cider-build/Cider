from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, status
from sqlmodel import Session as DbSession
from sqlmodel import select

from .config import settings
from .db import get_session
from .models import Org, OrgMembership, Session, User
from .models._time import utcnow

Db = Annotated[DbSession, Depends(get_session)]


def _session_cookie(
    request_cookie: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
) -> str | None:
    return request_cookie


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip() or None


def current_user(
    db: Db,
    cookie_token: Annotated[str | None, Depends(_session_cookie)],
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    # CLI/API clients send the session token as `Authorization: Bearer <token>`;
    # the dashboard sends it via the httponly cookie. Either works.
    token = _bearer_token(authorization) or cookie_token
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")

    session = db.get(Session, token)
    if not session or session.expires_at < utcnow():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "session invalid or expired")

    user = db.get(User, session.user_id)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "user not found")
    return user


CurrentUser = Annotated[User, Depends(current_user)]


def current_org(db: Db, user: CurrentUser) -> Org:
    """Resolve the active org for the user.

    For now a user has exactly one org via their first membership. Multi-org
    selection (e.g. via header or path param) can plug in here later.
    """
    membership = db.exec(
        select(OrgMembership).where(OrgMembership.user_id == user.id)
    ).first()
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "user has no org")

    org = db.get(Org, membership.org_id)
    if not org:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "org not found")
    return org


CurrentOrg = Annotated[Org, Depends(current_org)]
