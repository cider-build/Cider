from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///cider.db"
    session_cookie_name: str = "cider_session"
    session_lifetime_days: int = 30
    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]
    node_request_timeout: float = 30.0
    health_ping_interval_seconds: float = 10.0
    health_ping_timeout_seconds: float = 3.0

    model_config = SettingsConfigDict(env_prefix="CIDER_", env_file=".env", extra="ignore")


settings = Settings()
