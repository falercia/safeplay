-- Safe Play POC — schema base
-- Todos os dados são sintéticos. Nenhuma tabela armazena IP bruto ou dados reais.

create extension if not exists pgcrypto;

create schema if not exists app;
revoke all on schema app from public;
grant usage on schema app to authenticated, anon, service_role;

-- ---------- enums ----------
create type public.profile_role as enum ('player', 'guardian', 'moderator', 'presenter');
create type public.scenario_key as enum ('saudavel', 'progressivo', 'falso_positivo');
create type public.risk_level as enum ('baixo', 'atencao', 'alto', 'critico');
create type public.risk_trend as enum ('subindo', 'estavel', 'caindo');
create type public.recommendation_key as enum ('observar', 'conversar', 'revisar', 'acionar_suporte_humano');
create type public.job_status as enum ('pending', 'running', 'completed', 'failed', 'degraded');
create type public.case_status as enum ('open', 'in_review', 'needs_context', 'confirmed', 'dismissed', 'contained');
create type public.case_action_kind as enum (
  'confirm_risk', 'dismiss_false_positive', 'request_context', 'apply_demo_containment', 'approve_term', 'reject_term', 'reanalyze'
);
create type public.glossary_status as enum ('approved', 'candidate', 'rejected');
create type public.signal_source as enum ('rule', 'llm', 'both');
create type public.message_source as enum ('human', 'script');

-- ---------- sessões de demonstração ----------
create table public.demo_sessions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  scenario public.scenario_key not null,
  status text not null default 'active' check (status in ('active', 'archived')),
  presenter_auth_user_id uuid,
  script_cursor int not null default 0 check (script_cursor >= 0),
  settings jsonb not null default '{}'::jsonb,
  reset_count int not null default 0,
  created_at timestamptz not null default now()
);
create index demo_sessions_presenter_idx on public.demo_sessions (presenter_auth_user_id);

-- ---------- perfis (personas) ----------
create table public.profiles (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  role public.profile_role not null,
  persona_key text not null check (persona_key in ('A', 'B', 'guardian', 'moderator', 'presenter')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  tagline text not null default '',
  avatar text not null default '?',
  is_synthetic boolean not null default true,
  created_at timestamptz not null default now(),
  unique (session_id, persona_key)
);
create index profiles_session_idx on public.profiles (session_id);

-- vínculo entre usuário anônimo (auth.users) e persona; várias abas/dispositivos podem assumir a mesma persona na demo
create table public.profile_bindings (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  auth_user_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (profile_id, auth_user_id)
);
create index profile_bindings_user_idx on public.profile_bindings (auth_user_id);

-- ---------- salas ----------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  code text not null unique,
  name text not null,
  safety_level public.risk_level not null default 'baixo',
  safety_score int not null default 0 check (safety_score between 0 and 100),
  last_assessment_id uuid,
  contained boolean not null default false,
  contained_reason text,
  analysis_pending boolean not null default false,
  created_at timestamptz not null default now()
);
create index rooms_session_idx on public.rooms (session_id);

create table public.room_members (
  room_id uuid not null references public.rooms (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (room_id, profile_id)
);
create index room_members_profile_idx on public.room_members (profile_id);

create table public.guardian_links (
  id uuid primary key default gen_random_uuid(),
  guardian_profile_id uuid not null references public.profiles (id) on delete cascade,
  ward_profile_id uuid not null references public.profiles (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (guardian_profile_id, room_id)
);
create index guardian_links_guardian_idx on public.guardian_links (guardian_profile_id);

-- ---------- convites por papel ----------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  token text not null unique,
  role public.profile_role not null,
  uses int not null default 0,
  max_uses int not null default 20,
  expires_at timestamptz not null default now() + interval '2 days',
  created_at timestamptz not null default now()
);

-- ---------- mensagens ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  sender_profile_id uuid not null references public.profiles (id) on delete cascade,
  seq bigint not null,
  content text not null check (char_length(content) between 1 and 500),
  client_msg_id text not null check (char_length(client_msg_id) between 1 and 64),
  source public.message_source not null default 'human',
  created_at timestamptz not null default now(),
  unique (room_id, sender_profile_id, client_msg_id),
  unique (room_id, seq)
);
create index messages_room_seq_idx on public.messages (room_id, seq desc);
create index messages_sender_recent_idx on public.messages (sender_profile_id, created_at desc);

create or replace function app.assign_message_seq() returns trigger
language plpgsql as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.room_id::text));
  select coalesce(max(seq), 0) + 1 into new.seq from public.messages where room_id = new.room_id;
  return new;
end $$;
create trigger messages_assign_seq before insert on public.messages
  for each row execute function app.assign_message_seq();

-- ---------- jobs e avaliações ----------
create table public.analysis_jobs (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  trigger_type text not null check (trigger_type in ('message', 'moderator_reanalysis', 'script_forced')),
  trigger_message_id uuid references public.messages (id) on delete set null,
  status public.job_status not null default 'pending',
  degraded boolean not null default false,
  degraded_reason text,
  llm_trigger_reasons text[] not null default '{}',
  rule_latency_ms int,
  llm_latency_ms int,
  model text,
  rules_version text,
  error_code text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index analysis_jobs_room_idx on public.analysis_jobs (room_id, created_at desc);

create table public.risk_assessments (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  job_id uuid references public.analysis_jobs (id) on delete set null,
  score int not null check (score between 0 and 100),
  rule_score int not null check (rule_score between 0 and 100),
  llm_score int check (llm_score between 0 and 100),
  llm_confidence numeric(4,3),
  level public.risk_level not null,
  trend public.risk_trend not null,
  recommendation public.recommendation_key not null,
  guardian_summary text not null,
  divergence boolean not null default false,
  divergence_delta int,
  degraded boolean not null default false,
  method text not null check (method in ('regras', 'regras+llm')),
  window_message_ids uuid[] not null default '{}',
  details jsonb not null default '{}'::jsonb,
  rules_version text not null,
  model text,
  created_at timestamptz not null default now()
);
create index risk_assessments_room_idx on public.risk_assessments (room_id, created_at desc);
create index risk_assessments_window_gin on public.risk_assessments using gin (window_message_ids);

alter table public.rooms
  add constraint rooms_last_assessment_fk foreign key (last_assessment_id) references public.risk_assessments (id) on delete set null;

create table public.risk_signals (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references public.risk_assessments (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  signal_key text not null,
  occurrences int not null default 1,
  contribution numeric(6,2) not null default 0,
  evidence_message_ids uuid[] not null default '{}',
  source public.signal_source not null default 'rule',
  confidence numeric(4,3) not null default 0,
  created_at timestamptz not null default now()
);
create index risk_signals_assessment_idx on public.risk_signals (assessment_id);
create index risk_signals_room_idx on public.risk_signals (room_id);
create index risk_signals_evidence_gin on public.risk_signals using gin (evidence_message_ids);

-- ---------- glossário sintético versionado ----------
create table public.glossary_terms (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.demo_sessions (id) on delete cascade, -- null = base global do POC
  term text not null check (char_length(term) between 2 and 40),
  signal_key text not null,
  status public.glossary_status not null default 'candidate',
  version int not null default 1,
  synthetic boolean not null default true check (synthetic = true),
  notes text not null default '',
  proposed_by text not null default 'seed' check (proposed_by in ('seed', 'heuristica', 'llm', 'moderador')),
  reviewed_by_profile_id uuid references public.profiles (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index glossary_terms_unique_term on public.glossary_terms (coalesce(session_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(term));

-- ---------- alertas ----------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  assessment_id uuid references public.risk_assessments (id) on delete set null,
  level public.risk_level not null,
  title text not null,
  summary text not null,
  recommendation public.recommendation_key not null,
  dedupe_key text not null unique,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_room_idx on public.alerts (room_id, created_at desc);

-- ---------- casos e ações humanas ----------
create table public.cases (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  status public.case_status not null default 'open',
  priority int not null check (priority between 1 and 3),
  level public.risk_level not null,
  reason text not null,
  sla_minutes int not null,
  sla_due_at timestamptz not null,
  opened_by_assessment_id uuid references public.risk_assessments (id) on delete set null,
  latest_assessment_id uuid references public.risk_assessments (id) on delete set null,
  resolution text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
-- um único caso ativo por sala: reprocessamentos atualizam, nunca duplicam
create unique index cases_one_active_per_room on public.cases (room_id) where status in ('open', 'in_review', 'needs_context');
create index cases_queue_idx on public.cases (session_id, status, priority, sla_due_at);

create table public.case_actions (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases (id) on delete cascade,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action public.case_action_kind not null,
  justification text not null check (char_length(justification) between 10 and 1000),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index case_actions_case_idx on public.case_actions (case_id, created_at);

-- ---------- auditoria append-only ----------
create table public.audit_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete cascade,
  case_id uuid references public.cases (id) on delete cascade,
  event_type text not null,
  actor_type text not null check (actor_type in ('system', 'human', 'presenter')),
  actor_profile_id uuid references public.profiles (id) on delete set null,
  rules_version text,
  model text,
  latency_ms int,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_events_session_idx on public.audit_events (session_id, created_at desc);
create index audit_events_room_idx on public.audit_events (room_id, created_at desc);

create or replace function app.audit_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'audit_events é append-only (UPDATE proibido)';
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('app.allow_reset', true), 'off') <> 'on' then
    raise exception 'audit_events é append-only (DELETE só via reset de sessão)';
  end if;
  return old;
end $$;
create trigger audit_events_append_only before update or delete on public.audit_events
  for each row execute function app.audit_append_only();

-- ---------- uso e custo ----------
create table public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  session_id uuid references public.demo_sessions (id) on delete set null,
  room_id uuid references public.rooms (id) on delete set null,
  job_id uuid references public.analysis_jobs (id) on delete set null,
  provider text not null default 'anthropic',
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  est_cost_usd numeric(10,6) not null default 0,
  cached boolean not null default false,
  status text not null default 'ok' check (status in ('ok', 'error')),
  created_at timestamptz not null default now()
);
create index usage_ledger_day_idx on public.usage_ledger (created_at desc);
create index usage_ledger_room_idx on public.usage_ledger (room_id);

create table public.llm_cache (
  hash text primary key,
  model text not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

create table public.system_state (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- métricas medidas pelos clientes (apenas números, nunca conteúdo)
create table public.metric_samples (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  room_id uuid references public.rooms (id) on delete cascade,
  kind text not null check (kind in ('delivery_ms', 'rule_ms', 'llm_ms', 'realtime_connect_ms')),
  value_ms int not null check (value_ms between 0 and 600000),
  created_at timestamptz not null default now()
);
create index metric_samples_session_idx on public.metric_samples (session_id, kind);

-- ---------- funções auxiliares para RLS ----------
create or replace function app.my_profile_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select profile_id from public.profile_bindings where auth_user_id = auth.uid()
$$;

create or replace function app.my_session_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select p.session_id from public.profiles p join public.profile_bindings b on b.profile_id = p.id where b.auth_user_id = auth.uid()
$$;

create or replace function app.is_room_member(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.room_members rm
    join public.profile_bindings b on b.profile_id = rm.profile_id
    where rm.room_id = p_room and b.auth_user_id = auth.uid()
  )
$$;

create or replace function app.is_room_guardian(p_room uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.guardian_links gl
    join public.profile_bindings b on b.profile_id = gl.guardian_profile_id
    where gl.room_id = p_room and b.auth_user_id = auth.uid()
  )
$$;

create or replace function app.is_moderator(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    join public.profile_bindings b on b.profile_id = p.id
    where p.session_id = p_session and p.role = 'moderator' and b.auth_user_id = auth.uid()
  )
$$;

create or replace function app.is_presenter(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.demo_sessions s where s.id = p_session and s.presenter_auth_user_id = auth.uid()
  )
$$;

create or replace function app.room_session(p_room uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select session_id from public.rooms where id = p_room
$$;

grant execute on function app.my_profile_ids(), app.my_session_ids(), app.is_room_member(uuid), app.is_room_guardian(uuid),
  app.is_moderator(uuid), app.is_presenter(uuid), app.room_session(uuid) to authenticated, anon, service_role;

-- ---------- reset de sessão (somente service role) ----------
create or replace function public.admin_reset_session(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_reset', 'on', true);
  delete from public.demo_sessions where id = p_session;
end $$;
revoke all on function public.admin_reset_session(uuid) from public, anon, authenticated;

-- ---------- updated_at ----------
create or replace function app.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger cases_touch before update on public.cases for each row execute function app.touch_updated_at();

-- ---------- realtime ----------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
alter publication supabase_realtime add table
  public.messages, public.rooms, public.risk_assessments, public.alerts, public.cases, public.case_actions,
  public.analysis_jobs, public.demo_sessions, public.glossary_terms, public.audit_events;
