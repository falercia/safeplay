-- Testes de RLS, constraints e triggers. Executado como superusuário com troca de role por transação.
\set ON_ERROR_STOP on

-- ---------- fixture (service role) ----------
insert into auth.users (id) values
  ('11111111-1111-1111-1111-111111111111'), -- jogador A (humano)
  ('22222222-2222-2222-2222-222222222222'), -- responsável
  ('33333333-3333-3333-3333-333333333333'), -- moderador
  ('44444444-4444-4444-4444-444444444444'), -- apresentador
  ('55555555-5555-5555-5555-555555555555'); -- intruso de outra sessão

insert into public.demo_sessions (id, code, scenario, presenter_auth_user_id) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'MIT-TEST1', 'progressivo', '44444444-4444-4444-4444-444444444444'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'MIT-OTHER', 'saudavel', null);

insert into public.profiles (id, session_id, role, persona_key, display_name) values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'player', 'A', 'Nico'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001', 'player', 'B', 'Dex_77'),
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001', 'guardian', 'guardian', 'Responsável'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001', 'moderator', 'moderator', 'Moderador'),
  ('bbbbbbbb-0000-0000-0000-000000000009', 'aaaaaaaa-0000-0000-0000-000000000002', 'player', 'A', 'Outro');

insert into public.profile_bindings (profile_id, auth_user_id) values
  ('bbbbbbbb-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111'),
  ('bbbbbbbb-0000-0000-0000-000000000003', '22222222-2222-2222-2222-222222222222'),
  ('bbbbbbbb-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333'),
  ('bbbbbbbb-0000-0000-0000-000000000009', '55555555-5555-5555-5555-555555555555');

insert into public.rooms (id, session_id, code, name) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'R-TEST1', 'Arena Nimbus'),
  ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'R-OTHER', 'Outra sala');

insert into public.room_members (room_id, profile_id) values
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001'),
  ('cccccccc-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002'),
  ('cccccccc-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000009');

insert into public.guardian_links (guardian_profile_id, ward_profile_id, room_id) values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001');

insert into public.messages (id, room_id, session_id, sender_profile_id, seq, content, client_msg_id) values
  ('dddddddd-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 0, 'boa partida', 'c1'),
  ('dddddddd-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 0, 'valeu', 'c2'),
  ('dddddddd-0000-0000-0000-000000000003', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 0, 'quantos anos você tem?', 'c3'),
  ('dddddddd-0000-0000-0000-000000000004', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 0, 'não conta pra ninguém', 'c4'),
  ('dddddddd-0000-0000-0000-000000000005', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 0, 'tá', 'c5'),
  ('dddddddd-0000-0000-0000-000000000099', 'cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000009', 0, 'outra sala', 'c9');

-- seq atribuído por trigger, único por sala
do $$ begin
  assert (select array_agg(seq order by seq) from public.messages where room_id = 'cccccccc-0000-0000-0000-000000000001') = array[1,2,3,4,5]::bigint[], 'seq sequencial por sala';
end $$;

-- idempotência: mesma client_msg_id do mesmo remetente falha
do $$ begin
  begin
    insert into public.messages (room_id, session_id, sender_profile_id, content, client_msg_id)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'dup', 'c2');
    raise exception 'esperava violação de unicidade';
  exception when unique_violation then null; end;
end $$;

-- limite de 500 caracteres
do $$ begin
  begin
    insert into public.messages (room_id, session_id, sender_profile_id, content, client_msg_id)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', repeat('x', 501), 'c-long');
    raise exception 'esperava violação de check';
  exception when check_violation then null; end;
end $$;

insert into public.analysis_jobs (id, room_id, session_id, trigger_type, status) values
  ('eeeeeeee-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'message', 'completed');

insert into public.risk_assessments (id, room_id, session_id, job_id, score, rule_score, level, trend, recommendation, guardian_summary, method, window_message_ids, rules_version) values
  ('ffffffff-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'eeeeeeee-0000-0000-0000-000000000001', 30, 30, 'atencao', 'subindo', 'conversar', 'resumo', 'regras',
   array['dddddddd-0000-0000-0000-000000000003','dddddddd-0000-0000-0000-000000000004','dddddddd-0000-0000-0000-000000000005']::uuid[], 'rules-test');

insert into public.risk_signals (assessment_id, room_id, session_id, signal_key, evidence_message_ids) values
  ('ffffffff-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'informacao_pessoal', array['dddddddd-0000-0000-0000-000000000003']::uuid[]),
  ('ffffffff-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'pedido_segredo', array['dddddddd-0000-0000-0000-000000000004']::uuid[]);

insert into public.cases (id, room_id, session_id, priority, level, reason, sla_minutes, sla_due_at, opened_by_assessment_id, latest_assessment_id) values
  ('99999999-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 3, 'atencao', 'teste', 240, now() + interval '4 hours', 'ffffffff-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001');

-- um único caso ativo por sala
do $$ begin
  begin
    insert into public.cases (room_id, session_id, priority, level, reason, sla_minutes, sla_due_at)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 2, 'alto', 'dup', 60, now());
    raise exception 'esperava violação de unicidade de caso ativo';
  exception when unique_violation then null; end;
end $$;

insert into public.alerts (room_id, session_id, assessment_id, level, title, summary, recommendation, dedupe_key) values
  ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'ffffffff-0000-0000-0000-000000000001', 'atencao', 'Atenção', 'resumo', 'conversar', 'room1:atencao');

insert into public.audit_events (session_id, room_id, event_type, actor_type, payload) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'assessment.created', 'system', '{}');

-- auditoria append-only
do $$ begin
  begin
    update public.audit_events set event_type = 'x';
    raise exception 'esperava bloqueio de update';
  exception when raise_exception then null; end;
  begin
    delete from public.audit_events;
    raise exception 'esperava bloqueio de delete';
  exception when raise_exception then null; end;
end $$;

-- ---------- jogador A (humano) ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.messages) = 5, 'jogador lê apenas mensagens da própria sala';
  assert (select count(*) from public.rooms) = 1, 'jogador lê apenas sua sala';
  assert (select count(*) from public.risk_assessments) = 0, 'jogador não lê avaliações';
  assert (select count(*) from public.risk_signals) = 0, 'jogador não lê sinais';
  assert (select count(*) from public.cases) = 0, 'jogador não lê fila de moderação';
  assert (select count(*) from public.alerts) = 0, 'jogador não lê alertas';
  assert (select count(*) from public.audit_events) = 0, 'jogador não lê auditoria';
  assert (select count(*) from public.analysis_jobs) = 1, 'jogador vê status do job (sem conteúdo)';
  assert (select count(*) from public.profiles) = 4, 'jogador vê personas da própria sessão';
end $$;
-- escrita direta proibida
do $$ begin
  begin
    insert into public.messages (room_id, session_id, sender_profile_id, content, client_msg_id)
    values ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001', 'direto', 'cx');
    raise exception 'jogador não deveria inserir mensagens diretamente';
  exception when insufficient_privilege then null; end;
  begin
    update public.risk_assessments set score = 0;
    raise exception 'jogador não deveria alterar avaliações';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.audit_events (session_id, event_type, actor_type) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'human');
    raise exception 'jogador não deveria escrever auditoria';
  exception when insufficient_privilege then null; end;
  begin
    update public.profiles set role = 'moderator';
    raise exception 'jogador não deveria alterar papéis';
  exception when insufficient_privilege then null; end;
end $$;
-- métricas numéricas permitidas
insert into public.metric_samples (session_id, room_id, kind, value_ms) values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'delivery_ms', 120);
rollback;

-- ---------- responsável ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.messages) = 2, 'responsável lê apenas mensagens-evidência';
  assert (select count(*) from public.risk_assessments) = 1, 'responsável lê avaliações da sala vinculada';
  assert (select count(*) from public.alerts) = 1, 'responsável lê alertas';
  assert (select count(*) from public.cases) = 1, 'responsável vê estado do caso';
  assert (select count(*) from public.rooms) = 1, 'responsável lê apenas sala vinculada';
end $$;
update public.alerts set acknowledged_at = now();
do $$ begin
  begin
    update public.alerts set summary = 'x';
    raise exception 'responsável não deveria alterar conteúdo do alerta';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

-- ---------- moderador ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.cases) = 1, 'moderador lê a fila';
  assert (select count(*) from public.messages) = 3, 'moderador lê apenas a janela relevante (3 de 5)';
  assert (select count(*) from public.risk_signals) = 2, 'moderador lê sinais';
  assert (select count(*) from public.glossary_terms) >= 6, 'moderador lê glossário base';
  assert (select count(*) from public.audit_events) = 1, 'moderador lê auditoria';
end $$;
do $$ begin
  begin
    update public.cases set status = 'confirmed';
    raise exception 'moderador não altera casos diretamente (somente via Edge Function)';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

-- ---------- apresentador ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.demo_sessions) = 1, 'apresentador vê sua sessão';
  assert (select count(*) from public.messages) = 5, 'apresentador lê mensagens da sessão';
  assert (select count(*) from public.usage_ledger) = 0, 'ledger vazio mas acessível';
  assert (select count(*) from public.rooms) = 1, 'apresentador vê sala da sessão';
end $$;
rollback;

-- ---------- intruso de outra sessão ----------
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}', true);
do $$ begin
  assert (select count(*) from public.messages where room_id = 'cccccccc-0000-0000-0000-000000000001') = 0, 'intruso não lê a sala alheia';
  assert (select count(*) from public.cases) = 0, 'intruso não lê casos';
  assert (select count(*) from public.demo_sessions where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'intruso não vê sessão alheia';
end $$;
do $$ begin
  begin
    insert into public.metric_samples (session_id, room_id, kind, value_ms) values ('aaaaaaaa-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000001', 'delivery_ms', 1);
    raise exception 'intruso não deveria inserir métrica em sessão alheia';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

-- ---------- anônimo sem perfil ----------
begin;
set local role anon;
do $$ begin
  begin
    perform count(*) from public.messages;
    raise exception 'anon não deveria ler mensagens';
  exception when insufficient_privilege then null; end;
end $$;
rollback;

-- ---------- reset da sessão remove tudo, inclusive auditoria, sem afetar outras ----------
select public.admin_reset_session('aaaaaaaa-0000-0000-0000-000000000001');
do $$ begin
  assert (select count(*) from public.messages) = 1, 'reset removeu mensagens apenas da sessão';
  assert (select count(*) from public.audit_events) = 0, 'reset removeu auditoria da sessão';
  assert (select count(*) from public.cases) = 0, 'reset removeu casos';
  assert (select count(*) from public.demo_sessions) = 1, 'outra sessão preservada';
  assert (select count(*) from public.glossary_terms where session_id is null) >= 6, 'glossário base preservado';
end $$;

-- ---------- reset de dados preserva estrutura ----------
insert into public.messages (room_id, session_id, sender_profile_id, content, client_msg_id)
  values ('cccccccc-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000009', 'antes do reset', 'r1');
insert into public.audit_events (session_id, room_id, event_type, actor_type) values ('aaaaaaaa-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000002', 'x', 'system');
select public.admin_reset_session_data('aaaaaaaa-0000-0000-0000-000000000002');
do $$ begin
  assert (select count(*) from public.messages where session_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 0, 'reset de dados apagou mensagens';
  assert (select count(*) from public.audit_events where session_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 0, 'reset de dados apagou auditoria';
  assert (select count(*) from public.rooms where session_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 1, 'sala preservada';
  assert (select count(*) from public.profiles where session_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 1, 'personas preservadas';
  assert (select reset_count from public.demo_sessions where id = 'aaaaaaaa-0000-0000-0000-000000000002') = 1, 'contador de reset';
end $$;

-- ---------- admin_send_message: idempotência, rate limit e contenção ----------
do $$
declare r jsonb; i int;
begin
  insert into public.profile_bindings (profile_id, auth_user_id) values ('bbbbbbbb-0000-0000-0000-000000000009', '55555555-5555-5555-5555-555555555555') on conflict do nothing;
  r := public.admin_send_message('R-OTHER', '55555555-5555-5555-5555-555555555555', 'oi', 'k1');
  assert (r->>'duplicate') = 'false', 'primeira inserção';
  r := public.admin_send_message('R-OTHER', '55555555-5555-5555-5555-555555555555', 'oi', 'k1');
  assert (r->>'duplicate') = 'true', 'reenvio idempotente';
  r := public.admin_send_message('R-OTHER', '11111111-1111-1111-1111-111111111111', 'oi', 'k2');
  assert (r->>'error') = 'not_a_member', 'não membro bloqueado';
  for i in 2..6 loop perform public.admin_send_message('R-OTHER', '55555555-5555-5555-5555-555555555555', 'msg', 'k' || i::text); end loop;
  r := public.admin_send_message('R-OTHER', '55555555-5555-5555-5555-555555555555', 'msg', 'k99');
  assert (r->>'error') = 'rate_limited', 'rate limit por persona';
  update public.rooms set contained = true where code = 'R-OTHER';
  r := public.admin_send_message('R-OTHER', '55555555-5555-5555-5555-555555555555', 'msg', 'k100');
  assert (r->>'error') = 'room_contained', 'contenção bloqueia envio';
end $$;
