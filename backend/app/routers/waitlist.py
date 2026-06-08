import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session

from ..config import settings
from ..db import get_session
from ..models import WaitlistEntry

router = APIRouter(prefix="/waitlist")


class WaitlistIn(BaseModel):
    email: EmailStr
    turnstile_token: str


async def verify_turnstile(token: str) -> None:
    if not settings.turnstile_secret_key:
        raise HTTPException(500, "Turnstile is not configured")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://challenges.cloudflare.com/turnstile/v0/siteverify",
            data={"secret": settings.turnstile_secret_key, "response": token},
        )

    if not response.json().get("success"):
        raise HTTPException(400, "Bot verification failed")


@router.post("")
async def join_waitlist(body: WaitlistIn, db: Session = Depends(get_session)) -> dict:
    await verify_turnstile(body.turnstile_token)

    try:
        db.add(WaitlistEntry(email=body.email.lower().strip()))
        db.commit()
    except IntegrityError:
        db.rollback()

    return {"ok": True}
