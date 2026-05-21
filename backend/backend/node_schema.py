"""Wire schemas between the backend and a node service.

Kept separate from the public API (routers/sandboxes.py) so the boundary between
the two services is explicit and the schemas don't drift accidentally.
"""
from pydantic import BaseModel


class NodeCreateRequest(BaseModel):
    id: str


class NodeExecRequest(BaseModel):
    command: str


class NodeExecResponse(BaseModel):
    stdout: str
    stderr: str
    exit_code: int


class NodeIPResponse(BaseModel):
    ip: str
