-- Safe Play v2: mundos (lobby), jogadores por pessoa e papéis por código.
-- Uma sessão global (code = 'GLOBAL') agrega tudo; cada mundo tem exatamente uma sala (rooms), preservando o pipeline.

-- perfis por pessoa: persona_key 'player' e sem unicidade por persona
alter table public.profiles drop constraint if exists profiles_session_id_persona_key_key;
alter table public.profiles drop constraint if exists profiles_persona_key_check;
alter table public.profiles add constraint profiles_persona_key_check
  check (persona_key in ('A', 'B', 'player', 'guardian', 'moderator', 'presenter'));

create table public.worlds (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.demo_sessions (id) on delete cascade,
  room_id uuid not null unique references public.rooms (id) on delete cascade,
  code text not null unique,
  name text not null check (char_length(name) between 2 and 40),
  created_by_profile_id uuid references public.profiles (id) on delete set null,
  status text not null default 'open' check (status in ('open', 'closed')),
  scenario public.scenario_key not null default 'progressivo',
  script_cursor int not null default 0 check (script_cursor >= 0),
  max_players int not null default 2 check (max_players between 2 and 8),
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index worlds_session_status_idx on public.worlds (session_id, status, created_at desc);

alter table public.worlds enable row level security;
-- qualquer pessoa autenticada com perfil na sessão (jogador, moderador, responsável, apresentador) vê os mundos
create policy worlds_select on public.worlds for select to authenticated
  using (session_id in (select app.my_session_ids()) or app.is_presenter(session_id));
grant select on public.worlds to authenticated;

alter publication supabase_realtime add table public.worlds;

-- contagem de membros por sala visível a quem vê a sala (para o lobby)
create or replace view public.world_lobby with (security_invoker = true) as
  select w.id, w.code, w.name, w.status, w.created_at, w.max_players, w.session_id, w.room_id,
         (select count(*) from public.room_members rm where rm.room_id = w.room_id) as players,
         (select coalesce(string_agg(p.display_name, ', ' order by rm.joined_at), '') from public.room_members rm join public.profiles p on p.id = rm.profile_id where rm.room_id = w.room_id) as player_names,
         (select p.display_name from public.profiles p where p.id = w.created_by_profile_id) as creator_name
  from public.worlds w;
grant select on public.world_lobby to authenticated;

-- room_members visíveis a todos da sessão (lista do lobby precisa saber quem está em cada mundo)
drop policy if exists room_members_select on public.room_members;
create policy room_members_select on public.room_members for select to authenticated
  using (app.room_session(room_id) in (select app.my_session_ids()) or app.is_presenter(app.room_session(room_id)));

-- sessão global da demo
insert into public.demo_sessions (code, scenario, settings)
values ('GLOBAL', 'progressivo', '{}'::jsonb)
on conflict (code) do nothing;

-- reset de dados de um mundo (mantém o mundo, os membros e os vínculos)
create or replace function public.admin_reset_world(p_world uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_room uuid;
begin
  select room_id into v_room from public.worlds where id = p_world;
  if v_room is null then return; end if;
  perform set_config('app.allow_reset', 'on', true);
  delete from public.audit_events where room_id = v_room;
  delete from public.case_actions where case_id in (select id from public.cases where room_id = v_room);
  delete from public.cases where room_id = v_room;
  delete from public.alerts where room_id = v_room;
  delete from public.risk_signals where room_id = v_room;
  update public.rooms set last_assessment_id = null where id = v_room;
  delete from public.risk_assessments where room_id = v_room;
  delete from public.analysis_jobs where room_id = v_room;
  delete from public.messages where room_id = v_room;
  delete from public.metric_samples where room_id = v_room;
  update public.usage_ledger set room_id = null, job_id = null where room_id = v_room;
  update public.rooms set safety_level = 'baixo', safety_score = 0, contained = false, contained_reason = null, analysis_pending = false where id = v_room;
  update public.worlds set script_cursor = 0 where id = p_world;
end $$;
revoke all on function public.admin_reset_world(uuid) from public, anon, authenticated;
