from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///cider.db"
    cors_origins: list[str] = ["http://localhost:3000", "http://127.0.0.1:3000"]
    turnstile_secret_key: str = ""
    snapshot_dir: str = str(Path.home() / ".cider" / "snapshots")

    @field_validator("snapshot_dir", mode="before")
    @classmethod
    def expand_snapshot_dir(cls, value: str) -> str:
        return str(Path(value).expanduser())

    model_config = SettingsConfigDict(env_prefix="CIDER_", env_file=".env", extra="ignore")


settings = Settings()
