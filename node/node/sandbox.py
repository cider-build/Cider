"""Sandbox lifecycle stubs.

These are placeholders. Real macOS VM management (e.g. via tart) will hook in
here. For now create/exec/delete just succeed so the wider plumbing can be
exercised end-to-end.
"""


def create(sandbox_id: str) -> None:
    pass


def exec_command(sandbox_id: str, command: str) -> tuple[str, str, int]:
    return (f"[stub] would run on {sandbox_id}: {command}\n", "", 0)


def delete(sandbox_id: str) -> None:
    pass
