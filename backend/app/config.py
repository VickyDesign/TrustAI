from functools import lru_cache
from urllib.parse import quote, unquote

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def tidy_database_url(url: str) -> str:
    """Forgive the usual copy-paste slips in a Postgres URL: [brackets] left around the password,
    and symbols such as @ # / ? in the password that were not percent-encoded."""
    url = url.strip().strip('"').strip("'")
    if "://" not in url or "@" not in url:
        return url
    scheme, rest = url.split("://", 1)
    userinfo, hostpart = rest.rsplit("@", 1)  # the host never contains @, the password may
    if ":" not in userinfo:
        return url
    user, password = userinfo.split(":", 1)
    # Supabase passwords never contain brackets, so these are leftovers of [YOUR-PASSWORD].
    password = password.removeprefix("[").removesuffix("]")
    return f"{scheme}://{user}:{quote(unquote(password), safe='')}@{hostpart}"


class Settings(BaseSettings):
    """Environment configuration. See backend/.env.example for every value."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Supabase Postgres connection string (Project settings > Database > Connection string).
    database_url: str

    @field_validator("database_url")
    @classmethod
    def _tidy_db_url(cls, v: str) -> str:
        return tidy_database_url(v)

    # Supabase project URL, used to fetch the JWT signing keys (JWKS).
    supabase_url: str = ""
    # Supabase anon or publishable key (the same value the frontend uses). Lets the API verify
    # sessions through Supabase Auth when the project signs tokens with the legacy HS256 secret.
    supabase_anon_key: str = ""
    # Legacy HS256 JWT secret. Leave empty for projects that use asymmetric signing keys.
    supabase_jwt_secret: str = ""

    # Fernet key that encrypts agent credentials at rest.
    # Generate one with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    encryption_key: str

    # Comma-separated list of frontend origins allowed by CORS.
    cors_origins: str = "http://localhost:3000"
    # Optional regex for extra origins, e.g. Vercel preview deployments: https://plumb-.*\.vercel\.app
    cors_origin_regex: str = ""

    # OpenAI-compatible chat completions endpoint used for risk classification and judging.
    # Works with OpenAI, Azure OpenAI (v1 endpoint), Anthropic's OpenAI-compatible API, OpenRouter, etc.
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4.1-mini"

    # The backend calls user-supplied agent URLs. Private and loopback addresses are blocked
    # unless this is true (set it only for local development).
    allow_private_endpoints: bool = False

    # Public base URL of this backend, shown to users as the gateway address.
    # On Render this falls back to RENDER_EXTERNAL_URL, which Render sets automatically.
    public_api_url: str = ""
    render_external_url: str = ""

    @property
    def api_base_url(self) -> str:
        return (self.public_api_url or self.render_external_url or "http://localhost:8000").rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.llm_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
