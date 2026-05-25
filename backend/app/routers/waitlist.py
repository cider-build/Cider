import logging

import httpx
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from ..config import settings
from ..deps import Db
from ..models import WaitlistEntry

router = APIRouter(prefix="/waitlist", tags=["waitlist"])

_log = logging.getLogger(__name__)

_TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"


class WaitlistIn(BaseModel):
    email: EmailStr
    turnstile_token: str


class WaitlistOut(BaseModel):
    ok: bool


async def _verify_turnstile(token: str) -> bool:
    secret = settings.turnstile_secret_key
    if not secret:
        _log.error("CIDER_TURNSTILE_SECRET_KEY not set; rejecting waitlist signup")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Server misconfigured.")

    async with httpx.AsyncClient(timeout=10.0) as client:
        r = await client.post(
            _TURNSTILE_VERIFY_URL,
            data={"secret": secret, "response": token},
        )
    payload = r.json()
    return bool(payload.get("success"))


@router.post("", response_model=WaitlistOut)
async def join_waitlist(body: WaitlistIn, db: Db) -> WaitlistOut:
    if not await _verify_turnstile(body.turnstile_token):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Bot verification failed. Please try again.")

    email = body.email.lower().strip()
    existing = db.exec(select(WaitlistEntry).where(WaitlistEntry.email == email)).first()
    if existing:
        return WaitlistOut(ok=True)

    try:
        db.add(WaitlistEntry(email=email))
        db.commit()
    except IntegrityError:
        db.rollback()
    return WaitlistOut(ok=True)
