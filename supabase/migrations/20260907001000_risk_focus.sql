-- Direcionamento do aviso de acolhimento no chat.
-- O motor continua agnóstico ao remetente na avaliação da sala, mas a COMUNICAÇÃO é direcionada:
-- risk_focus_profile_id aponta o perfil que concentra o peso dos sinais (hipótese sujeita a validação humana);
-- o aviso de acolhimento aparece apenas para os demais membros da sala, nunca para quem emite os sinais.
-- Limitação declarada do POC: a coluna é legível pelos membros da sala (RLS de rooms); um produto real
-- calcularia o aviso no servidor, por membro.

alter table public.rooms add column if not exists risk_focus_profile_id uuid references public.profiles (id) on delete set null;

comment on column public.rooms.risk_focus_profile_id is
  'Perfil que concentra o peso dos sinais de risco na última avaliação (hipótese, não veredito). Null quando não há concentração clara.';

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
  update public.rooms set safety_level = 'baixo', safety_score = 0, contained = false, contained_reason = null, analysis_pending = false, risk_focus_profile_id = null where id = v_room;
  update public.worlds set script_cursor = 0 where id = p_world;
end $$;
revoke all on function public.admin_reset_world(uuid) from public, anon, authenticated;
