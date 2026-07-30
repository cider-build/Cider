import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Annotated

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from sqlmodel import Session, select

from .config import settings
from .db import session_dependency
from .models import ApiToken, AuthSession, OrganizationMembership, User

ph = PasswordHasher()


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_days * 24 * 60 * 60,
        httponly=True,
        secure=settings.auth_cookie_requires_https,
        samesite="lax",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(settings.session_cookie_name, httponly=True, secure=settings.auth_cookie_requires_https, samesite="lax")


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError):
        return False


@dataclass
class AuthContext:
    user: User
    membership: OrganizationMembership


def bearer_auth_context(authorization: str | None, db: Session) -> AuthContext:
    if not authorization:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    scheme, separator, token = authorization.partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "invalid authorization header")
    api_token = db.exec(select(ApiToken).where(ApiToken.token_hash == hash_token(token))).first()
    if api_token is None or api_token.expires_at <= utc_now():
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    user = db.get(User, api_token.user_id)
    membership = db.exec(
        select(OrganizationMembership).where(
            OrganizationMembership.user_id == api_token.user_id
        )
    ).first()
    if user is None or membership is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return AuthContext(user=user, membership=membership)


def current_auth_context(
    cider_session: Annotated[str | None, Cookie(alias=settings.session_cookie_name)] = None,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(session_dependency),
) -> AuthContext:
    if authorization:
        return bearer_auth_context(authorization, db)

    if not cider_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")

    session = db.exec(select(AuthSession).where(AuthSession.token_hash == hash_token(cider_session))).first()
    if session is None or session.expires_at <= utc_now():
        if session is not None:
            db.delete(session)
            db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")

    user = db.get(User, session.user_id)
    membership = db.exec(select(OrganizationMembership).where(OrganizationMembership.user_id == session.user_id)).first()
    if user is None or membership is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "not authenticated")
    return AuthContext(user=user, membership=membership)


def create_session(db: Session, response: Response, user_id: str) -> None:
    token = secrets.token_urlsafe(32)
    db.add(
        AuthSession(
            user_id=user_id,
            token_hash=hash_token(token),
            expires_at=utc_now() + timedelta(days=settings.session_days),
        )
    )
    db.commit()
    set_session_cookie(response, token)
