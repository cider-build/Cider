import os
import secrets
import shutil


TART = os.environ.get("TART") or shutil.which("tart") or "tart"
BASE_VM = os.environ.get("CIDER_BASE_VM", "base")
SANDBOX_PREFIX = os.environ.get("CIDER_SANDBOX_PREFIX", "cider-")
STOP_TIMEOUT_SECONDS = int(os.environ.get("STOP_TIMEOUT_SECONDS", "30"))


def new_sandbox_id() -> str:
    return f"{SANDBOX_PREFIX}{secrets.token_hex(16)}"
