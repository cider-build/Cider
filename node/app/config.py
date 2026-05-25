import os
import shutil
from pathlib import Path


def _resolve_ciderctl() -> str:
    explicit = os.environ.get("CIDER_CTL")
    if explicit:
        return explicit
    found = shutil.which("ciderctl")
    if not found:
        raise RuntimeError(
            "ciderctl binary not found. Build node/vm-cli and set CIDER_CTL, "
            "or install ciderctl on PATH."
        )
    return found


CIDERCTL = _resolve_ciderctl()
BASE_BUNDLE = os.environ.get("CIDER_BASE_BUNDLE", str(Path.home() / ".cider" / "base"))
MAX_SANDBOXES = int(os.environ.get("MAX_SANDBOXES", "2"))
EXEC_TIMEOUT_SECONDS = int(os.environ.get("EXEC_TIMEOUT_SECONDS", "120"))
START_TIMEOUT_SECONDS = int(os.environ.get("START_TIMEOUT_SECONDS", "120"))
