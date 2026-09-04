-- Reset de dados da sessão preservando códigos, personas, convites e vínculos (links continuam válidos).
create or replace function public.admin_reset_session_data(p_session uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform set_config('app.allow_reset', 'on', true);
  delete from public.audit_events where session_id = p_session;
  delete from public.case_actions where session_id = p_session;
  delete from public.cases where session_id = p_session;
  delete from public.alerts where session_id = p_session;
  delete from public.risk_signals where session_id = p_session;
  update public.rooms set last_assessment_id = null where session_id = p_session;
  delete from public.risk_assessments where session_id = p_session;
  delete from public.analysis_jobs where session_id = p_session;
  delete from public.messages where session_id = p_session;
  delete from public.metric_samples where session_id = p_session;
  delete from public.glossary_terms where session_id = p_session and status = 'candidate';
  update public.usage_ledger set session_id = null, room_id = null, job_id = null where session_id = p_session; -- custo permanece no ledger diário
  update public.rooms set safety_level = 'baixo', safety_score = 0, contained = false, contained_reason = null, analysis_pending = false where session_id = p_session;
  update public.demo_sessions set script_cursor = 0, reset_count = reset_count + 1 where id = p_session;
end $$;
revoke all on function public.admin_reset_session_data(uuid) from public, anon, authenticated;

-- apresentador: dono da sessão ou qualquer usuário vinculado ao perfil "presenter" da sessão
create or replace function app.is_presenter(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.demo_sessions s where s.id = p_session and s.presenter_auth_user_id = auth.uid()
  ) or exists (
    select 1 from public.profiles p
    join public.profile_bindings b on b.profile_id = p.id
    where p.session_id = p_session and p.role = 'presenter' and b.auth_user_id = auth.uid()
  )
$$;
