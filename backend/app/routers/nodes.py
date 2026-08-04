import math
import secrets
from datetime import datetime, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlmodel import select

from ..auth import AuthContext, current_auth_context, hash_token
from ..db import get_session
from ..models import Node, NodeCredential, Sandbox
from ..services import warm_pool
from ..services.node_gateway import node_gateway

router = APIRouter(prefix="/nodes")
PAGE_SIZE = 10
NodeName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class NodeOut(BaseModel):
    id: str
    name: str
    connected: bool
    metadata: "NodeMetadataOut | None"
    configuration: "NodeConfigurationOut | None"


class NodeMetadataIn(BaseModel):
    hardware_model: str = Field(min_length=1, max_length=120)
    chip: str = Field(min_length=1, max_length=120)
    macos_version: str = Field(min_length=1, max_length=40)
    cpu_count: int = Field(ge=1)
    memory_bytes: int = Field(ge=1)
    storage_total_bytes: int = Field(ge=1)
    storage_available_bytes: int = Field(ge=0)
    default_sandbox_cpu_count: int = Field(ge=1)
    default_sandbox_memory_bytes: int = Field(ge=1)
    default_sandbox_storage_bytes: int = Field(ge=1)


class NodeMetadataOut(BaseModel):
    hardware_model: str
    chip: str
    macos_version: str
    cpu_count: int
    memory_bytes: int
    storage_total_bytes: int
    storage_available_bytes: int


class NodeConfigurationIn(BaseModel):
    vm_count: Literal[1, 2]
    sandbox_cpu_count: int = Field(ge=1)
    sandbox_memory_bytes: int = Field(ge=1)
    sandbox_storage_bytes: int = Field(ge=1)


class NodeConfigurationOut(NodeConfigurationIn):
    pass


class NodePage(BaseModel):
    items: list[NodeOut]
    page: int
    pages: int
    total: int


class NodeEnrollmentIn(BaseModel):
    name: NodeName


class NodeEnrollmentOut(BaseModel):
    id: str
    name: str
    token: str


def apply_node_metadata(node: Node, metadata: NodeMetadataIn) -> None:
    node.hardware_model = metadata.hardware_model
    node.chip = metadata.chip
    node.macos_version = metadata.macos_version
    node.cpu_count = metadata.cpu_count
    node.memory_bytes = metadata.memory_bytes
    node.storage_total_bytes = metadata.storage_total_bytes
    node.storage_available_bytes = metadata.storage_available_bytes
    if (
        node.sandbox_cpu_count is None
        and node.sandbox_memory_bytes is None
        and node.sandbox_storage_bytes is None
    ):
        node.vm_count = 2 if (
            metadata.default_sandbox_cpu_count * 2 <= metadata.cpu_count
            and metadata.default_sandbox_memory_bytes * 2 <= metadata.memory_bytes
            and metadata.default_sandbox_storage_bytes * 2 <= metadata.storage_total_bytes
        ) else 1
    if node.sandbox_cpu_count is None:
        node.sandbox_cpu_count = metadata.default_sandbox_cpu_count
    if node.sandbox_memory_bytes is None:
        node.sandbox_memory_bytes = metadata.default_sandbox_memory_bytes
    if node.sandbox_storage_bytes is None:
        node.sandbox_storage_bytes = metadata.default_sandbox_storage_bytes


def node_out(node: Node) -> NodeOut:
    metadata = None
    if all(
        value is not None
        for value in (
            node.hardware_model,
            node.chip,
            node.macos_version,
            node.cpu_count,
            node.memory_bytes,
            node.storage_total_bytes,
            node.storage_available_bytes,
        )
    ):
        metadata = NodeMetadataOut(
            hardware_model=node.hardware_model,
            chip=node.chip,
            macos_version=node.macos_version,
            cpu_count=node.cpu_count,
            memory_bytes=node.memory_bytes,
            storage_total_bytes=node.storage_total_bytes,
            storage_available_bytes=node.storage_available_bytes,
        )

    configuration = None
    if all(
        value is not None
        for value in (
            node.sandbox_cpu_count,
            node.sandbox_memory_bytes,
            node.sandbox_storage_bytes,
        )
    ):
        configuration = NodeConfigurationOut(
            vm_count=node.vm_count,
            sandbox_cpu_count=node.sandbox_cpu_count,
            sandbox_memory_bytes=node.sandbox_memory_bytes,
            sandbox_storage_bytes=node.sandbox_storage_bytes,
        )

    return NodeOut(
        id=node.id,
        name=node.name,
        connected=node_gateway.is_connected(node.id),
        metadata=metadata,
        configuration=configuration,
    )


@router.get("")
async def list_nodes(
    ctx: AuthContext = Depends(current_auth_context),
    page: int = Query(default=1, ge=1),
    search: str = "",
) -> NodePage:
    with get_session() as db:
        query = (
            select(Node)
            .join(NodeCredential, NodeCredential.node_id == Node.id)
            .where(Node.org_id == ctx.membership.organization_id)
        )
        count_query = (
            select(func.count())
            .select_from(Node)
            .join(NodeCredential, NodeCredential.node_id == Node.id)
            .where(Node.org_id == ctx.membership.organization_id)
        )
        if search:
            like = f"%{search}%"
            query = query.where(Node.name.like(like))
            count_query = count_query.where(Node.name.like(like))
        total = db.exec(count_query).one()
        pages = max(1, math.ceil(total / PAGE_SIZE))
        page = min(page, pages)
        items = db.exec(query.order_by(Node.name).offset((page - 1) * PAGE_SIZE).limit(PAGE_SIZE)).all()
    return NodePage(items=[node_out(node) for node in items], page=page, pages=pages, total=total)


@router.get("/{node_id}")
async def get_node(
    node_id: str,
    ctx: AuthContext = Depends(current_auth_context),
) -> NodeOut:
    with get_session() as db:
        node = db.get(Node, node_id)
        credential = db.get(NodeCredential, node_id)
        if node is None or node.org_id != ctx.membership.organization_id or credential is None:
            raise HTTPException(404, "node not found")
    return node_out(node)


@router.patch("/{node_id}/configuration")
async def update_node_configuration(
    node_id: str,
    body: NodeConfigurationIn,
    ctx: AuthContext = Depends(current_auth_context),
) -> NodeOut:
    with get_session() as db:
        node = db.get(Node, node_id)
        if node is None or node.org_id != ctx.membership.organization_id:
            raise HTTPException(404, "node not found")
        if not node_gateway.is_connected(node.id):
            raise HTTPException(409, "node must be connected to change its configuration")
        if warm_pool.warming[node.id] > 0:
            raise HTTPException(409, "wait for node provisioning to finish before changing its configuration")
        if node.cpu_count is None or node.memory_bytes is None or node.storage_available_bytes is None:
            raise HTTPException(409, "node hardware metadata is unavailable")
        if body.sandbox_cpu_count * body.vm_count > node.cpu_count:
            raise HTTPException(422, "configured sandboxes exceed the node's CPU capacity")
        if body.sandbox_memory_bytes * body.vm_count > node.memory_bytes:
            raise HTTPException(422, "configured sandboxes exceed the node's memory capacity")
        if body.sandbox_storage_bytes * body.vm_count > node.storage_available_bytes:
            raise HTTPException(422, "configured sandboxes exceed the node's available storage")

        node.vm_count = body.vm_count
        node.sandbox_cpu_count = body.sandbox_cpu_count
        node.sandbox_memory_bytes = body.sandbox_memory_bytes
        node.sandbox_storage_bytes = body.sandbox_storage_bytes
        db.add(node)
        db.commit()
        db.refresh(node)

    await warm_pool.reconcile_node_warm_pool(node_id)
    return node_out(node)


@router.post("/enrollments", status_code=201)
async def enroll_node(body: NodeEnrollmentIn, ctx: AuthContext = Depends(current_auth_context)) -> NodeEnrollmentOut:
    token = secrets.token_urlsafe(32)
    with get_session() as db:
        existing = db.exec(select(Node).where(Node.org_id == ctx.membership.organization_id, Node.name == body.name)).first()
        if existing is not None:
            if node_gateway.is_connected(existing.id):
                raise HTTPException(409, "node name already exists and is connected")
            # Reactivate the retained node (possibly revoked) with a freshly rotated credential.
            credential = db.get(NodeCredential, existing.id)
            if credential is None:
                credential = NodeCredential(node_id=existing.id, token_hash=hash_token(token))
            else:
                credential.token_hash = hash_token(token)
                credential.created_at = datetime.now(timezone.utc).replace(tzinfo=None)
            db.add(credential)
            db.commit()
            return NodeEnrollmentOut(id=existing.id, name=existing.name, token=token)

        node = Node(name=body.name, org_id=ctx.membership.organization_id)
        db.add(node)
        db.add(NodeCredential(node_id=node.id, token_hash=hash_token(token)))
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "node name already exists")
        return NodeEnrollmentOut(id=node.id, name=node.name, token=token)


@router.delete("/{node_id}", status_code=204)
async def delete_node(node_id: str, ctx: AuthContext = Depends(current_auth_context)) -> None:
    with get_session() as db:
        node = db.get(Node, node_id)
        credential = db.get(NodeCredential, node_id)
        if node is None or node.org_id != ctx.membership.organization_id or credential is None:
            raise HTTPException(404, "node not found")

        sandboxes = db.exec(select(Sandbox).where(Sandbox.node_id == node_id, Sandbox.deleted_at.is_(None))).all()
        if node_gateway.is_connected(node_id) and any(
            sandbox.org_id is not None and sandbox.status not in ("stopped", "paused")
            for sandbox in sandboxes
        ):
            raise HTTPException(409, "node has active sandboxes; delete them first")

        # Revoking the credential removes the node; its row is kept so sandbox history stays intact.
        # A stopped sandbox's state is in Cider storage and survives revoking its source node.
        # Other sandboxes remain node-local and become unreachable with the node.
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        for sandbox in sandboxes:
            # stopped and paused state lives in Cider storage; it survives the node.
            if sandbox.status in ("stopped", "paused"):
                continue
            sandbox.deleted_at = now
            db.add(sandbox)
        db.delete(credential)
        db.commit()
    await node_gateway.disconnect(node_id)
