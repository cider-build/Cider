import os


class Settings:
    database_url: str = os.environ.get("CIDER_DATABASE_URL", "sqlite:///cider.db")
    cors_origins: list[str] = os.environ.get("CIDER_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
    turnstile_secret_key: str = os.environ.get("CIDER_TURNSTILE_SECRET_KEY", "")
    sandbox_ttl_seconds: int = int(os.environ.get("CIDER_SANDBOX_TTL_SECONDS", str(5 * 60)))
    warm_sandboxes_per_node: int = int(os.environ.get("CIDER_WARM_SANDBOXES_PER_NODE", "2"))
    sandbox_create_wait_seconds: int = int(os.environ.get("CIDER_SANDBOX_CREATE_WAIT_SECONDS", "120"))
    session_days: int = int(os.environ.get("CIDER_SESSION_DAYS", "30"))
    cli_token_days: int = int(os.environ.get("CIDER_CLI_TOKEN_DAYS", "90"))
    session_cookie_name: str = os.environ.get("CIDER_SESSION_COOKIE_NAME", "cider_session")
    auth_cookie_requires_https: bool = os.environ.get("CIDER_AUTH_COOKIE_REQUIRES_HTTPS", "false").lower() == "true"
    snapshot_storage_path: str = os.path.expanduser(
        os.environ.get("CIDER_SNAPSHOT_STORAGE", "~/.cider/snapshots")
    )


settings = Settings()
