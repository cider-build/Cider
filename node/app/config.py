import os
import shutil


def _resolve_tart() -> str:
    explicit = os.environ.get("TART")
    if explicit:
        return explicit
    found = shutil.which("tart")
    if not found:
        raise RuntimeError("tart binary not found. Install Tart or set TART.")
    return found


TART = _resolve_tart()
BASE_VM = os.environ.get("CIDER_BASE_VM", "base")
SANDBOX_PREFIX = os.environ.get("CIDER_SANDBOX_PREFIX", "cider-")
MAX_SANDBOXES = int(os.environ.get("MAX_SANDBOXES", "2"))
EXEC_TIMEOUT_SECONDS = int(os.environ.get("EXEC_TIMEOUT_SECONDS", "120"))
START_TIMEOUT_SECONDS = int(os.environ.get("START_TIMEOUT_SECONDS", "120"))
STOP_TIMEOUT_SECONDS = int(os.environ.get("STOP_TIMEOUT_SECONDS", "30"))
SSH_USER = os.environ.get("CIDER_SSH_USER", "admin")
SSH_KEY = os.environ.get("CIDER_SSH_KEY", os.path.expanduser("~/.cider/ssh_key"))
SSH_CONNECT_TIMEOUT_SECONDS = int(os.environ.get("SSH_CONNECT_TIMEOUT_SECONDS", "10"))
VNC_PASSWORD = os.environ.get("CIDER_VNC_PASSWORD", "Test1234!")
VM_ADMIN_PASSWORD = os.environ.get("CIDER_VM_ADMIN_PASSWORD", "Test1234!")
