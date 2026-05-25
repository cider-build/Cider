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
    # How long a sandbox can go without a reconciler confirmation before we
    # give up on its node and mark it stopped. Set ~3x the ping interval so a
    # transient blip doesn't kill live sandboxes, but a real node outage
    # clears them within ~30s. last_seen_at is bumped every successful tick.
    sandbox_unseen_grace_seconds: float = 30.0

    # macOS Screen Sharing legacy-VNC password configured inside each sandbox VM.
    # Baked into the vnc:// URL so the Connect button doesn't prompt. Override
    # via CIDER_VNC_PASSWORD if you want a different shared secret.
    vnc_password: str = "TEST1234!"

    # Cloudflare Turnstile secret used to verify the marketing-page waitlist
    # form. Unset in dev; the /waitlist endpoint refuses to write without it.
    turnstile_secret_key: str = ""

    model_config = SettingsConfigDict(env_prefix="CIDER_", env_file=".env", extra="ignore")


settings = Settings()
