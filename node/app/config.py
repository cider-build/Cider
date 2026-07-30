import os
import secrets
import shutil


LUME = shutil.which(os.environ.get("LUME", "lume"))
if LUME is None:
    raise RuntimeError("Lume is not installed or LUME is not executable")
BASE_VM = os.environ.get("CIDER_BASE_VM", "base")
VM_STORAGE = os.environ.get("CIDER_VM_STORAGE", os.path.expanduser("~/.cider/vms"))
SANDBOX_PREFIX = os.environ.get("CIDER_SANDBOX_PREFIX", "cider-")
SNAPSHOT_PREFIX = f"{SANDBOX_PREFIX}snap-"
START_TIMEOUT_SECONDS = int(os.environ.get("START_TIMEOUT_SECONDS", "120"))
SSH_USER = os.environ.get("CIDER_SSH_USER", "lume")
SSH_KEY = os.environ.get("CIDER_SSH_KEY", os.path.expanduser("~/.cider/ssh_key"))
SSH_PASSWORD = os.environ.get("CIDER_SSH_PASSWORD")
GUEST_DIR = os.environ.get("CIDER_GUEST_DIR", f"/Users/{SSH_USER}/cider")
NODE_PORT = int(os.environ.get("CIDER_NODE_PORT", "8001"))
API_URL = os.environ.get("CIDER_API_URL")
NODE_ID = os.environ.get("CIDER_NODE_ID")
NODE_TOKEN = os.environ.get("CIDER_NODE_TOKEN")
BASE_IMAGE_ID_PATH = os.environ.get(
    "CIDER_BASE_IMAGE_ID_PATH",
    os.path.expanduser("~/.cider/cider-base.image-id"),
)
SNAPSHOT_CHUNK_SIZE = int(os.environ.get("CIDER_SNAPSHOT_CHUNK_SIZE", str(4 * 1024 * 1024)))


def new_sandbox_id() -> str:
    return f"{SANDBOX_PREFIX}{secrets.token_hex(16)}"


def snapshot_vm_name(snapshot_id: str) -> str:
    return f"{SNAPSHOT_PREFIX}{snapshot_id}"


def vm_path(name: str) -> str:
    return os.path.join(VM_STORAGE, name)


def require_storage_config() -> tuple[str, str, str]:
    if not API_URL or not NODE_ID or not NODE_TOKEN:
        raise RuntimeError("portable snapshots require CIDER_API_URL, CIDER_NODE_ID, and CIDER_NODE_TOKEN")
    return API_URL.rstrip("/"), NODE_ID, NODE_TOKEN
