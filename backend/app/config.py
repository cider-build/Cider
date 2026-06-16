import os
from pathlib import Path


class Settings:
    database_url: str = os.environ.get("CIDER_DATABASE_URL", "sqlite:///cider.db")
    cors_origins: list[str] = os.environ.get("CIDER_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    turnstile_secret_key: str = os.environ.get("CIDER_TURNSTILE_SECRET_KEY", "")
    snapshot_dir: str = str(Path(os.environ.get("CIDER_SNAPSHOT_DIR", Path.home() / ".cider" / "snapshots")).expanduser())
    sandbox_ttl_seconds: int = int(os.environ.get("CIDER_SANDBOX_TTL_SECONDS", str(5 * 60)))
    warm_sandboxes_per_node: int = int(os.environ.get("CIDER_WARM_SANDBOXES_PER_NODE", "2"))
    max_sandboxes_per_node: int = min(int(os.environ.get("CIDER_MAX_SANDBOXES_PER_NODE", "2")), 2)
    sandbox_create_wait_seconds: int = int(os.environ.get("CIDER_SANDBOX_CREATE_WAIT_SECONDS", "120"))


settings = Settings()
