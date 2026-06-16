import os
from pathlib import Path


class Settings:
    database_url: str = os.environ.get("CIDER_DATABASE_URL", "sqlite:///cider.db")
    cors_origins: list[str] = os.environ.get("CIDER_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    turnstile_secret_key: str = os.environ.get("CIDER_TURNSTILE_SECRET_KEY", "")
    snapshot_dir: str = str(Path(os.environ.get("CIDER_SNAPSHOT_DIR", Path.home() / ".cider" / "snapshots")).expanduser())
    sandbox_ttl_seconds: int = int(os.environ.get("CIDER_SANDBOX_TTL_SECONDS", str(5 * 60)))


settings = Settings()
