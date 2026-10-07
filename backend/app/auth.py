"""Supabase session verification and the per-request workspace context."""
from dataclasses import dataclass

import jwt
from fastapi import Depends, Header, HTTPException, status
from jwt import PyJWKClient

from . import db
from .config import get_settings

_jwks_client: PyJWKClient | None = None


def _jwks() -> PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        url = get_settings().supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(url, cache_keys=True)
    return _jwks_client


def verify_token(token: str) -> dict:
    """Return the token claims, or raise 401. Supports HS256 secrets and JWKS signing keys."""
    s = get_settings()
    try:
        header = jwt.get_unverified_header(token)
        if header.get("alg") == "HS256":
            if not s.supabase_jwt_secret:
                raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Server is missing SUPABASE_JWT_SECRET")
            return jwt.decode(token, s.supabase_jwt_secret, algorithms=["HS256"], audience="authenticated")
        key = _jwks().get_signing_key_from_jwt(token).key
        return jwt.decode(token, key, algorithms=["RS256", "ES256"], audience="authenticated")
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Your session has expired. Sign in again.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid session token")


@dataclass
class User:
    id: str
    email: str
    name: str


@dataclass
class Ctx:
    user: User
    org_id: str
    org_name: str
    role: str

    @property
    def is_admin(self) -> bool:
        return self.role == "admin"

    def has_role(self, role: str) -> bool:
        return self.role == "admin" or self.role == role


async def current_user(authorization: str = Header(default="")) -> User:
    if not authorization.lower().startswith("bearer "):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sign in to continue")
    claims = verify_token(authorization.split(" ", 1)[1])
    meta = claims.get("user_metadata") or {}
    email = claims.get("email") or ""
    name = meta.get("full_name") or meta.get("name") or email.split("@")[0]
    return User(id=claims["sub"], email=email, name=name)


async def ensure_membership(user: User) -> dict:
    """Return the user's first membership, creating a workspace on first sign-in."""
    row = await db.fetchrow(
        """select m.org_id, m.role, o.name as org_name from members m
           join organizations o on o.id = m.org_id
           where m.user_id = %s order by m.created_at limit 1""",
        user.id,
    )
    if row:
        return row
    org = await db.fetchrow(
        "insert into organizations (name) values (%s) returning id, name",
        f"{user.name.title()}'s workspace",
    )
    assert org
    await db.execute(
        "insert into members (org_id, user_id, email, display_name, role) values (%s, %s, %s, %s, 'admin')",
        org["id"], user.id, user.email, user.name,
    )
    return {"org_id": org["id"], "role": "admin", "org_name": org["name"]}


async def current_ctx(user: User = Depends(current_user)) -> Ctx:
    m = await ensure_membership(user)
    return Ctx(user=user, org_id=str(m["org_id"]), org_name=m["org_name"], role=m["role"])
