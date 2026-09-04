-- Glossário SINTÉTICO base (versão 1). Termos inventados para o POC; nenhum corresponde a códigos reais.
insert into public.glossary_terms (session_id, term, signal_key, status, version, notes, proposed_by) values
  (null, 'modo fantasma', 'pedido_segredo', 'approved', 1, '[sintético] combinado para "não contar a ninguém"', 'seed'),
  (null, 'portal zp', 'migracao_canal', 'approved', 1, '[sintético] nome fictício de app externo', 'seed'),
  (null, 'cofre azul', 'recompensa_promessa', 'approved', 1, '[sintético] promessa de item raro em troca de algo', 'seed'),
  (null, 'mapa da casa', 'informacao_pessoal', 'approved', 1, '[sintético] pedido de endereço/rotina', 'seed'),
  (null, 'nivel 99 de confiança', 'vinculo_progressivo', 'approved', 1, '[sintético] intimidade acelerada', 'seed'),
  (null, 'chave lunar', 'conteudo_inadequado', 'approved', 1, '[sintético] referência a conteúdo impróprio', 'seed')
on conflict do nothing;

insert into public.system_state (key, value) values
  ('llm_breaker', '{"failures":0,"open_until":null}'::jsonb),
  ('budget', '{"daily_budget_usd":2,"room_call_limit":50,"cooldown_seconds":15,"min_new_messages":3}'::jsonb)
on conflict (key) do nothing;
