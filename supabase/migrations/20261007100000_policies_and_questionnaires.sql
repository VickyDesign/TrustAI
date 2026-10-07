-- Policies (reusable rule sets), the risk questionnaire, and owner-written test questions.
create table if not exists policies (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references organizations(id) on delete cascade,
  name         text not null,
  description  text,
  is_default   boolean not null default false,
  rules        jsonb not null default '{}'::jsonb,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists policies_org_idx on policies (org_id);
alter table policies enable row level security;

alter table agents add column if not exists policy_id uuid references policies(id) on delete set null;
alter table agents add column if not exists questionnaire jsonb not null default '{}'::jsonb;
alter table agents add column if not exists test_questions jsonb not null default '[]'::jsonb;

alter table agents drop constraint if exists agents_onboarding_step_check;
alter table agents add constraint agents_onboarding_step_check check (onboarding_step between 1 and 5);
