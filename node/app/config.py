import os
import secrets
import shutil


TART = shutil.which(os.environ.get("TART", "tart"))
if TART is None:
    raise RuntimeError("Tart is not installed or TART is not executable")
BASE_VM = os.environ.get("CIDER_BASE_VM", "base")
SANDBOX_PREFIX = os.environ.get("CIDER_SANDBOX_PREFIX", "cider-")
START_TIMEOUT_SECONDS = int(os.environ.get("START_TIMEOUT_SECONDS", "120"))
STOP_TIMEOUT_SECONDS = int(os.environ.get("STOP_TIMEOUT_SECONDS", "30"))
SSH_USER = os.environ.get("CIDER_SSH_USER", "admin")
SSH_KEY = os.environ.get("CIDER_SSH_KEY", os.path.expanduser("~/.cider/ssh_key"))
GUEST_DIR = os.environ.get("CIDER_GUEST_DIR", "/Users/admin/cider")
NODE_PORT = int(os.environ.get("CIDER_NODE_PORT", "8001"))


def new_sandbox_id() -> str:
    return f"{SANDBOX_PREFIX}{secrets.token_hex(16)}"
