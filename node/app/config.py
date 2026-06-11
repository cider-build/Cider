import os
import secrets
import shutil


TART = os.environ.get("TART") or shutil.which("tart") or "tart"
BASE_VM = os.environ.get("CIDER_BASE_VM", "base")
SANDBOX_PREFIX = os.environ.get("CIDER_SANDBOX_PREFIX", "cider-")
START_TIMEOUT_SECONDS = int(os.environ.get("START_TIMEOUT_SECONDS", "120"))
STOP_TIMEOUT_SECONDS = int(os.environ.get("STOP_TIMEOUT_SECONDS", "30"))
SSH_USER = os.environ.get("CIDER_SSH_USER", "admin")
SSH_KEY = os.environ.get("CIDER_SSH_KEY", os.path.expanduser("~/.cider/ssh_key"))
GUEST_DIR = os.environ.get("CIDER_GUEST_DIR", "/Users/admin/cider")
DISPLAY_BIND_HOST = os.environ.get("CIDER_DISPLAY_BIND_HOST", "127.0.0.1")
DISPLAY_PUBLIC_HOST = os.environ.get("CIDER_DISPLAY_PUBLIC_HOST", DISPLAY_BIND_HOST)
DISPLAY_GUEST_PORT = int(os.environ.get("CIDER_DISPLAY_GUEST_PORT", "5900"))
DISPLAY_USERNAME = os.environ.get("CIDER_DISPLAY_USERNAME", "admin")
DISPLAY_PASSWORD = os.environ.get("CIDER_DISPLAY_PASSWORD", "Test1234!")


def new_sandbox_id() -> str:
    return f"{SANDBOX_PREFIX}{secrets.token_hex(16)}"
