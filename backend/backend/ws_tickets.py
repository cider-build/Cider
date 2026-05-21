"""Short-lived single-use tickets that bridge HTTP cookie auth to WebSocket auth.

The session cookie is SameSite=Lax + HttpOnly, so the browser won't send it on
cross-origin WS handshakes and JS can't read it to put in the URL. The dashboard
calls POST /auth/ws-ticket via authenticated HTTP, gets a ticket, then appends it
to the WS URL.
"""
import secrets
import time
from dataclasses import dataclass


@dataclass
class _Ticket:
    user_id: str
    expires_at: float
    used: bool = False


_TICKETS: dict[str, _Ticket] = {}
_TTL_SECONDS = 30


def issue(user_id: str) -> str:
    _gc()
    token = secrets.token_urlsafe(24)
    _TICKETS[token] = _Ticket(user_id=user_id, expires_at=time.monotonic() + _TTL_SECONDS)
    return token


def redeem(token: str | None) -> str | None:
    """Return the user_id for a valid ticket, mark it used. Returns None if
    invalid, expired, or already redeemed."""
    if not token:
        return None
    _gc()
    ticket = _TICKETS.get(token)
    if ticket is None or ticket.used or ticket.expires_at < time.monotonic():
        return None
    ticket.used = True
    return ticket.user_id


def _gc() -> None:
    now = time.monotonic()
    for tok in [t for t, v in _TICKETS.items() if v.expires_at < now]:
        _TICKETS.pop(tok, None)
