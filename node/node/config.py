import os
import shutil
from pathlib import Path


def _resolve_ciderctl() -> str:
    explicit = os.environ.get("CIDER_CTL")
    if explicit:
        return explicit
    found = shutil.which("ciderctl")
    if found:
        return found
    # Fall back to the in-repo release build.
    here = Path(__file__).resolve()
    repo_bin = here.parents[1] / "ciderctl" / ".build" / "release" / "ciderctl"
    return str(repo_bin)


CIDERCTL = _resolve_ciderctl()
BASE_BUNDLE = os.environ.get("CIDER_BASE_BUNDLE", str(Path.home() / ".cider" / "base"))
MAX_SANDBOXES = int(os.environ.get("MAX_SANDBOXES", "2"))
EXEC_TIMEOUT_SECONDS = int(os.environ.get("EXEC_TIMEOUT_SECONDS", "120"))
START_TIMEOUT_SECONDS = int(os.environ.get("START_TIMEOUT_SECONDS", "120"))
