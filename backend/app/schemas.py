from typing import Literal

from pydantic import BaseModel, Field

Protocol = Literal["http", "a2a", "adk", "openai", "directline", "bedrock"]
AuthType = Literal["none", "bearer", "api_key", "oauth2"]


class Tool(BaseModel):
    name: str = Field(max_length=120)
    description: str = Field(default="", max_length=300)
    access: Literal["read", "write"] = "read"
    enabled: bool = True


class AgentIn(BaseModel):
    """Fields a user can set while onboarding or editing an agent. Every field is optional on update."""
    name: str | None = Field(default=None, min_length=1, max_length=120)
    team: str | None = Field(default=None, max_length=120)
    purpose: str | None = Field(default=None, max_length=2000)
    audience: Literal["internal", "customers", "partners", "public"] | None = None
    owner_user_id: str | None = None
    owner_name: str | None = Field(default=None, max_length=120)
    protocol: Protocol | None = None
    endpoint_url: str | None = Field(default=None, max_length=2000)
    auth_type: AuthType | None = None
    auth_header: str | None = Field(default=None, max_length=120)
    auth_secret: str | None = Field(default=None, max_length=8000, description="Write only; stored encrypted")
    request_template: str | None = Field(default=None, max_length=8000)
    response_key: str | None = Field(default=None, max_length=200)
    timeout_s: int | None = Field(default=None, ge=1, le=300)
    max_retries: int | None = Field(default=None, ge=0, le=5)
    data_sources: list[str] | None = None
    tools: list[Tool] | None = None
    onboarding_step: int | None = Field(default=None, ge=1, le=4)


class TestIn(BaseModel):
    message: str = Field(default="Hello! In one sentence, what can you help me with?", max_length=4000)


class DecisionIn(BaseModel):
    decision: Literal["approved", "rejected"]
    comment: str | None = Field(default=None, max_length=1000)


class DeployIn(BaseModel):
    rollout: Literal["gradual", "all"] = "gradual"
    auto_rollback: bool = True
    alert_channel: str | None = Field(default=None, max_length=200)


class InvokeIn(BaseModel):
    input: str = Field(min_length=1, max_length=20000)
    session_id: str | None = Field(default=None, max_length=200)


class KeyIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class RoleIn(BaseModel):
    role: Literal["admin", "risk_owner", "security", "member"]


class JoinIn(BaseModel):
    code: str = Field(min_length=6, max_length=64)


class OrgIn(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    allow_self_approval: bool | None = None
