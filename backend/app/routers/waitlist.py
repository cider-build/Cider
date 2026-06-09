import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.exc import IntegrityError

from ..config import settings
from ..db import get_session
from ..models import WaitlistEntry

router = APIRouter(prefix="/waitlist")
http = httpx.AsyncClient()


class WaitlistIn(BaseModel):
    email: EmailStr
    turnstile_token: str


async def verify_turnstile(token: str) -> None:
    if not settings.turnstile_secret_key:
        raise HTTPException(500, "Turnstile is not configured")

    response = await http.post(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify",
        data={"secret": settings.turnstile_secret_key, "response": token},
    )

    if not response.json().get("success"):
        raise HTTPException(400, "Bot verification failed")


@router.post("")
async def join_waitlist(body: WaitlistIn) -> dict:
    await verify_turnstile(body.turnstile_token)

    db = get_session()
    try:
        db.add(WaitlistEntry(email=body.email.lower().strip()))
        db.commit()
    except IntegrityError:
        db.rollback()

    return {"ok": True}
