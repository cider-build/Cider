"""Typed HTTP client for talking to a node service.

Callers pass a Pydantic response model; this module handles transport, status-code
forwarding, and validation. No untyped dicts cross the boundary.
"""
import logging
import time
from typing import TypeVar

import httpx
from fastapi import HTTPException, status
from pydantic import BaseModel, ValidationError

from .config import settings

log = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def _forward_error(response: httpx.Response) -> None:
    try:
        body = response.json()
        detail = body.get("detail", body) if isinstance(body, dict) else body
    except ValueError:
        detail = response.text
    raise HTTPException(response.status_code, detail)


async def _send(
    method: str,
    node_url: str,
    path: str,
    *,
    body: BaseModel | None,
) -> httpx.Response:
    url = f"{node_url.rstrip('/')}{path}"
    payload = body.model_dump() if body is not None else None
    log.info("%s %s start", method, url)
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=settings.node_request_timeout) as client:
            response = await client.request(method, url, json=payload)
    except httpx.TimeoutException:
        elapsed = time.monotonic() - started
        log.warning(
            "%s %s TIMEOUT after %.1fs (limit=%.1fs) — node likely cold-spawning",
            method, url, elapsed, settings.node_request_timeout,
        )
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, f"node {node_url} timed out")
    except httpx.HTTPError as e:
        elapsed = time.monotonic() - started
        log.warning("%s %s UNREACHABLE after %.1fs: %s", method, url, elapsed, e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"node {node_url} unreachable: {e}")
    elapsed = time.monotonic() - started
    log.info("%s %s -> %d in %.2fs", method, url, response.status_code, elapsed)
    return response


async def call(
    method: str,
    node_url: str,
    path: str,
    *,
    body: BaseModel | None = None,
    response_model: type[T],
) -> T:
    response = await _send(method, node_url, path, body=body)
    if response.status_code >= 400:
        _forward_error(response)
    try:
        return response_model.model_validate_json(response.content)
    except ValidationError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"node {node_url} returned unexpected payload: {e}"
        )


async def fire(
    method: str,
    node_url: str,
    path: str,
    *,
    body: BaseModel | None = None,
) -> None:
    """Request where the caller doesn't care about the response body."""
    response = await _send(method, node_url, path, body=body)
    if response.status_code >= 400:
        _forward_error(response)
