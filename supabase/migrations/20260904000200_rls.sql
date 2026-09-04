-- Safe Play POC — Row Level Security
-- Princípios: participante lê apenas suas salas; responsável lê apenas salas vinculadas e evidências mínimas;
-- moderador lê casos e a janela relevante; clientes nunca escrevem avaliações, alertas, papéis ou auditoria.

alter table public.demo_sessions enable row level security;
alter table public.profiles enable row level security;
alter table public.profile_bindings enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.guardian_links enable row level security;
alter table public.invites enable row level security;
alter table public.messages enable row level security;
alter table public.analysis_jobs enable row level security;
alter table public.risk_assessments enable row level security;
alter table public.risk_signals enable row level security;
alter table public.glossary_terms enable row level security;
alter table public.alerts enable row level security;
alter table public.cases enable row level security;
alter table public.case_actions enable row level security;
alter table public.audit_events enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.llm_cache enable row level security;
alter table public.system_state enable row level security;
alter table public.metric_samples enable row level security;

-- sessões: quem tem perfil na sessão ou é o apresentador
create policy demo_sessions_select on public.demo_sessions for select to authenticated
  using (id in (select app.my_session_ids()) or presenter_auth_user_id = auth.uid());

-- perfis: visíveis para quem participa da mesma sessão (nomes de personas no chat)
create policy profiles_select on public.profiles for select to authenticated
  using (session_id in (select app.my_session_ids()) or app.is_presenter(session_id));

create policy profile_bindings_select on public.profile_bindings for select to authenticated
  using (auth_user_id = auth.uid());

-- salas: membro, responsável vinculado, moderador ou apresentador
create policy rooms_select on public.rooms for select to authenticated
  using (app.is_room_member(id) or app.is_room_guardian(id) or app.is_moderator(session_id) or app.is_presenter(session_id));

create policy room_members_select on public.room_members for select to authenticated
  using (app.is_room_member(room_id) or app.is_room_guardian(room_id) or app.is_moderator(app.room_session(room_id)) or app.is_presenter(app.room_session(room_id)));

create policy guardian_links_select on public.guardian_links for select to authenticated
  using (guardian_profile_id in (select app.my_profile_ids()) or app.is_presenter(app.room_session(room_id)));

-- convites: nunca expostos ao cliente (resgate via Edge Function)

-- mensagens
create policy messages_select_member on public.messages for select to authenticated
  using (app.is_room_member(room_id));

-- responsável: apenas mensagens referenciadas como evidência de sinais (minimização de exposição)
create policy messages_select_guardian_evidence on public.messages for select to authenticated
  using (
    app.is_room_guardian(room_id)
    and exists (
      select 1 from public.risk_signals rs
      where rs.room_id = messages.room_id and messages.id = any (rs.evidence_message_ids)
    )
  );

-- moderador: apenas a janela relevante de avaliações ligadas a um caso da sala
create policy messages_select_moderator_window on public.messages for select to authenticated
  using (
    app.is_moderator(session_id)
    and exists (
      select 1 from public.risk_assessments ra
      join public.cases c on c.room_id = ra.room_id
      where ra.room_id = messages.room_id and messages.id = any (ra.window_message_ids)
    )
  );

create policy messages_select_presenter on public.messages for select to authenticated
  using (app.is_presenter(session_id));

-- jobs: status visível a membros (para "analisando contexto"), responsável, moderador e apresentador
create policy analysis_jobs_select on public.analysis_jobs for select to authenticated
  using (app.is_room_member(room_id) or app.is_room_guardian(room_id) or app.is_moderator(session_id) or app.is_presenter(session_id));

-- avaliações e sinais: responsável (sala vinculada), moderador, apresentador. Jogadores NÃO leem.
create policy risk_assessments_select on public.risk_assessments for select to authenticated
  using (app.is_room_guardian(room_id) or app.is_moderator(session_id) or app.is_presenter(session_id));

create policy risk_signals_select on public.risk_signals for select to authenticated
  using (app.is_room_guardian(room_id) or app.is_moderator(session_id) or app.is_presenter(session_id));

-- glossário: base global (session_id null) e termos da própria sessão, para moderador/apresentador
create policy glossary_terms_select on public.glossary_terms for select to authenticated
  using (
    (session_id is null and exists (select 1 from public.profiles p join public.profile_bindings b on b.profile_id = p.id where b.auth_user_id = auth.uid() and p.role in ('moderator','presenter')))
    or (session_id is not null and (app.is_moderator(session_id) or app.is_presenter(session_id)))
    or exists (select 1 from public.demo_sessions s where s.presenter_auth_user_id = auth.uid())
  );

-- alertas
create policy alerts_select on public.alerts for select to authenticated
  using (app.is_room_guardian(room_id) or app.is_moderator(session_id) or app.is_presenter(session_id));
create policy alerts_ack_guardian on public.alerts for update to authenticated
  using (app.is_room_guardian(room_id)) with check (app.is_room_guardian(room_id));

-- casos e ações: moderador, apresentador e responsável (somente leitura da decisão)
create policy cases_select on public.cases for select to authenticated
  using (app.is_moderator(session_id) or app.is_presenter(session_id) or app.is_room_guardian(room_id));
create policy case_actions_select on public.case_actions for select to authenticated
  using (
    app.is_moderator(session_id) or app.is_presenter(session_id)
    or exists (select 1 from public.cases c where c.id = case_actions.case_id and app.is_room_guardian(c.room_id))
  );

-- auditoria: leitura para moderador/apresentador; responsável vê eventos da sala vinculada
create policy audit_events_select on public.audit_events for select to authenticated
  using (app.is_moderator(session_id) or app.is_presenter(session_id) or (room_id is not null and app.is_room_guardian(room_id)));

-- ledger de uso: apresentador da sessão
create policy usage_ledger_select on public.usage_ledger for select to authenticated
  using (session_id is not null and app.is_presenter(session_id));

-- llm_cache e system_state: sem acesso de cliente

-- métricas: membros/responsável/moderador inserem números; apresentador e moderador leem
create policy metric_samples_insert on public.metric_samples for insert to authenticated
  with check (
    session_id in (select app.my_session_ids())
    and (room_id is null or app.is_room_member(room_id) or app.is_room_guardian(room_id) or app.is_moderator(session_id))
  );
create policy metric_samples_select on public.metric_samples for select to authenticated
  using (app.is_presenter(session_id) or app.is_moderator(session_id));

-- limpeza de privilégios: clientes não recebem INSERT/UPDATE/DELETE por padrão
revoke insert, update, delete on all tables in schema public from anon, authenticated;
grant select on all tables in schema public to authenticated;
grant insert on public.metric_samples to authenticated;
grant update (acknowledged_at) on public.alerts to authenticated;
revoke all on public.llm_cache, public.system_state, public.invites from anon, authenticated;
