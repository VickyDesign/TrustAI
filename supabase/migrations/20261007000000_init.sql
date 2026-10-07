-- Plumb: AI fleet console
-- Initial schema. The FastAPI backend connects with the database's service role
-- (it bypasses RLS). Row level security is enabled on every table with no
-- policies, so the browser's anon key can read nothing directly: the frontend
-- only uses Supabase for sign-in and talks to the backend for data.

create extension if not exists pgcrypto;

create type member_role as enum ('admin', 'risk_owner', 'security', 'member');
create type agent_status as enum (
  'draft', 'evaluating', 'evaluated', 'blocked',
  'awaiting_approval', 'approved', 'live', 'paused', 'rejected'
);
create type agent_protocol as enum ('http', 'a2a', 'adk', 'openai', 'directline', 'bedrock');

create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- Workspaces and people -------------------------------------------------------

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  settings    jsonb not null default '{"allow_self_approval": true}',
  created_at  timestamptz not null default now()
);

create table members (
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null,
  email         text not null,
  display_name  text,
  role          member_role not null default 'member',
  created_at    timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user_idx on members(user_id);

-- Agents ----------------------------------------------------------------------

create table agents (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references organizations(id) on delete cascade,
  name              text not null,
  slug              text not null,
  team              text,
  purpose           text,
  audience          text not null default 'internal',
  owner_user_id     uuid,
  owner_name        text,
  protocol          agent_protocol not null default 'http',
  endpoint_url      text,
  auth_type         text not null default 'none' check (auth_type in ('none', 'bearer', 'api_key', 'oauth2')),
  auth_header       text,
  auth_secret_enc   text,
  request_template  text,
  response_key      text,
  timeout_s         int  not null default 60 check (timeout_s between 1 and 300),
  max_retries       int  not null default 2 check (max_retries between 0 and 5),
  data_sources      text[] not null default '{}',
  tools             jsonb not null default '[]',
  status            agent_status not null default 'draft',
  onboarding_step   int  not null default 1 check (onboarding_step between 1 and 4),
  risk_tier         int  check (risk_tier between 1 and 3),
  risk_assessment   jsonb,
  last_test         jsonb,
  version           text not null default 'v1.0',
  rollout           jsonb,
  deployed_at       timestamptz,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, slug)
);
create index agents_org_idx on agents(org_id, status);
create trigger agents_updated before update on agents for each row execute function set_updated_at();

-- Evaluations -----------------------------------------------------------------

create table evaluation_runs (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  agent_id     uuid not null references agents(id) on delete cascade,
  status       text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'error')),
  progress     int  not null default 0,
  summary      jsonb,
  error        text,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index evaluation_runs_agent_idx on evaluation_runs(agent_id, created_at desc);

create table evaluation_results (
  id            uuid primary key default gen_random_uuid(),
  run_id        uuid not null references evaluation_runs(id) on delete cascade,
  suite         text not null,
  title         text not null,
  description   text,
  position      int  not null,
  status        text not null default 'queued' check (status in ('queued', 'running', 'passed', 'failed', 'warning', 'skipped')),
  score         numeric,
  threshold     numeric,
  result_label  text,
  details       jsonb not null default '{}',
  updated_at    timestamptz not null default now()
);
create index evaluation_results_run_idx on evaluation_results(run_id, position);

create table evaluation_cases (
  id          uuid primary key default gen_random_uuid(),
  run_id      uuid not null references evaluation_runs(id) on delete cascade,
  suite       text not null,
  input       text not null,
  output      text,
  verdict     text not null check (verdict in ('pass', 'fail', 'error')),
  reason      text,
  latency_ms  int,
  created_at  timestamptz not null default now()
);
create index evaluation_cases_run_idx on evaluation_cases(run_id, suite);

-- Release ---------------------------------------------------------------------

create table approvals (
  id               uuid primary key default gen_random_uuid(),
  org_id           uuid not null references organizations(id) on delete cascade,
  agent_id         uuid not null references agents(id) on delete cascade,
  required_role    member_role not null,
  status           text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  requested_by     uuid,
  decided_by       uuid,
  decided_by_name  text,
  comment          text,
  requested_at     timestamptz not null default now(),
  decided_at       timestamptz
);
create index approvals_agent_idx on approvals(agent_id, requested_at desc);

create table deployments (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references organizations(id) on delete cascade,
  agent_id       uuid not null references agents(id) on delete cascade,
  version        text not null,
  rollout        text not null check (rollout in ('gradual', 'all')),
  auto_rollback  boolean not null default true,
  alert_channel  text,
  status         text not null default 'active' check (status in ('active', 'rolled_back', 'superseded', 'paused')),
  created_by     uuid,
  created_at     timestamptz not null default now()
);
create index deployments_agent_idx on deployments(agent_id, created_at desc);

-- Gateway and monitoring ------------------------------------------------------

create table gateway_keys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  name          text not null,
  prefix        text not null,
  key_hash      text not null unique,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create table requests (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references organizations(id) on delete cascade,
  agent_id           uuid not null references agents(id) on delete cascade,
  deployment_id      uuid references deployments(id) on delete set null,
  session_id         text,
  started_at         timestamptz not null default now(),
  latency_ms         int,
  status             text not null check (status in ('ok', 'error', 'blocked')),
  http_status        int,
  error              text,
  input_preview      text,
  output_preview     text,
  guardrail_actions  jsonb not null default '[]'
);
create index requests_agent_time_idx on requests(agent_id, started_at desc);
create index requests_org_time_idx on requests(org_id, started_at desc);

create table spans (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references requests(id) on delete cascade,
  parent_id    uuid,
  name         text not null,
  kind         text not null check (kind in ('agent', 'guardrail', 'llm', 'tool', 'mcp', 'http')),
  start_ms     int not null,
  duration_ms  int not null,
  attributes   jsonb not null default '{}'
);
create index spans_request_idx on spans(request_id, start_ms);

create table activity (
  id          bigserial primary key,
  org_id      uuid not null references organizations(id) on delete cascade,
  agent_id    uuid references agents(id) on delete cascade,
  actor_id    uuid,
  actor_name  text,
  kind        text not null,
  message     text not null,
  data        jsonb not null default '{}',
  created_at  timestamptz not null default now()
);
create index activity_agent_idx on activity(agent_id, created_at desc);

-- Lock every table to the backend -------------------------------------------

alter table organizations      enable row level security;
alter table members            enable row level security;
alter table agents             enable row level security;
alter table evaluation_runs    enable row level security;
alter table evaluation_results enable row level security;
alter table evaluation_cases   enable row level security;
alter table approvals          enable row level security;
alter table deployments        enable row level security;
alter table gateway_keys       enable row level security;
alter table requests           enable row level security;
alter table spans              enable row level security;
alter table activity           enable row level security;
