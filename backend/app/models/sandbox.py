from datetime import datetime
from enum import Enum

from sqlmodel import Field, SQLModel

from ._ids import new_id
from ._time import utcnow


class SandboxStatus(str, Enum):
    pending = "pending"
    running = "running"
    # Reconciler observed the VM is gone (node reports it missing or stopped,
    # or the node itself has been unreachable past the grace window). Terminal
    # — sandbox can't be revived, user must create a new one.
    stopped = "stopped"
    deleted = "deleted"
    failed = "failed"


# Statuses where the sandbox is considered alive — used by routers and the
# reconciler to decide what to ignore (terminal) vs. what to keep tracking.
ACTIVE_STATUSES: frozenset[SandboxStatus] = frozenset(
    {SandboxStatus.pending, SandboxStatus.running}
)


class Sandbox(SQLModel, table=True):
    id: str = Field(default_factory=new_id, primary_key=True)
    org_id: str = Field(foreign_key="org.id", index=True)
    node_id: str = Field(foreign_key="node.id", index=True)
    status: SandboxStatus = Field(default=SandboxStatus.pending)
    created_at: datetime = Field(default_factory=utcnow)
    deleted_at: datetime | None = None
    # Bumped by the reconciler whenever it sees the VM alive on the node.
    # Drives the "node unreachable too long" path: if last_seen_at is older
    # than the grace window and the node isn't responding, we mark stopped.
    last_seen_at: datetime | None = None
    # Set when status moves to `stopped` — gives the UI a "why".
    stopped_reason: str | None = None
    stopped_at: datetime | None = None
