from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import FileResponse
from sqlmodel import select

from ..auth import hash_token
from ..db import get_session
from ..models import Node, NodeCredential
from ..snapshot_store import blob_path, write_blob

router = APIRouter(prefix="/node-storage", tags=["node-storage"])


def current_storage_node(
    authorization: Annotated[str | None, Header()] = None,
) -> Node:
    scheme, separator, token = (authorization or "").partition(" ")
    if separator != " " or scheme.lower() != "bearer" or not token:
        raise HTTPException(401, "invalid node credential")
    with get_session() as db:
        credential = db.exec(
            select(NodeCredential).where(NodeCredential.token_hash == hash_token(token))
        ).first()
        node = db.get(Node, credential.node_id) if credential is not None else None
    if node is None:
        raise HTTPException(401, "invalid node credential")
    return node


@router.head("/blobs/{digest}", status_code=204)
async def has_blob(digest: str, node: Node = Depends(current_storage_node)) -> None:
    if not blob_path(node.org_id, digest).exists():
        raise HTTPException(404, "blob not found")


@router.put("/blobs/{digest}", status_code=204)
async def put_blob(
    digest: str,
    request: Request,
    node: Node = Depends(current_storage_node),
) -> None:
    await write_blob(node.org_id, digest, request)


@router.get("/blobs/{digest}")
async def get_blob(digest: str, node: Node = Depends(current_storage_node)) -> FileResponse:
    path = blob_path(node.org_id, digest)
    if not path.exists():
        raise HTTPException(404, "blob not found")
    return FileResponse(path, media_type="application/octet-stream")
