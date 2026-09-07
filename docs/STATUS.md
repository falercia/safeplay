# Estado do projeto · atualizado 2026-09-06

## Pronto e verificado
- Motor de risco, schema/RLS, Edge Functions, front-end: lint, typecheck, build, 20 testes unitários e testes SQL passando.
- Projeto Supabase `ygwfghnwgqrzfwibmnwr` (região us-west-2): 5 migrations aplicadas, 4 Edge Functions publicadas, secrets configurados (PRESENTER_SECRET, ANTHROPIC_API_KEY, modelo claude-haiku-4-5, orçamento US$ 2/dia, 50 chamadas/sala).
- Login anônimo ativo; limite de logins anônimos elevado para 300/hora por IP (padrão 30 derrubava os testes).
- E2E Playwright executados contra o Supabase real, a partir do Mac (5 specs: progressivo em 5 contextos, saudável, falso positivo, degradado, RLS): **todos passando**. Entrega medida: 872 ms (caminho quente), 1,9 s (cold start da função).

## Como retomar
1. Repositório: pasta do projeto → `safe-play/` (git, último commit `aad0943`). `pnpm install`, `.env.local` já contém URL e anon key.
2. Rodar local: `pnpm dev` → http://localhost:3000 (Jogar). Códigos: secrets do Supabase (Edge Functions → Secrets).
3. E2E: ver README (três etapas, variáveis `E2E_*`).

## Sessão 2 (2026-09-06)
- Latência da LLM: p50 6,8 s → 4,0 s, sem timeouts (saída enxuta, prefill JSON, max_tokens 600).
- Tela do jogador virou jogo + chat: Arena Nimbus (canvas 2D procedural, RPG cooperativo simulado, não interativo, sem reação ao risco). E2E progressivo passou contra a URL pública com o novo layout. Capturas em docs/capturas/00-jogo-chat*.png.

## Sessão 3 (2026-09-07) · v2 no ar
- Backend v2 (tabela `worlds`, view `world_lobby`, sessão GLOBAL, functions `game-enter`, `world-create`, `world-join`, `role-login`, `demo-control` por mundo) e front-end v2 completos: `/` (Jogar), `/entrar`, `/lobby`, `/mundo/[code]` (jogo com sprites CC0 Kenney + chat), `/moderacao`, `/responsavel`, `/apresentador` (com status dos serviços, modelo, uso/custo, métricas e Plano B). Rotas v1 removidas. Ver docs/REDESIGN-v2.md.
- Migrations 7 e 8 (realtime em `room_members` e `profiles`) aplicadas. Functions `world-create`/`world-join` devolvem o código da sala.
- E2E v2 em três etapas **passando contra a URL pública** a partir do Mac (dois jogadores reais, entrega 1,9 s fria / 0,9 s quente, roteiro progressivo → Alto → caso único → Crítico → decisão humana refletida no responsável). Capturas em `docs/capturas/00–05`.
- Deploy público atualizado (Vercel). Códigos de acesso: secrets do Supabase (GAME_ACCESS_CODE, MODERATOR_CODE, GUARDIAN_CODE, PRESENTER_SECRET).
- Pendências: ensaio final do roteiro (docs/roteiro-apresentacao.md, já adaptado ao v2); repositório GitHub `falercia/safeplay` aguarda `git push --force -u origin main` pelo Fabio; opcional: conectar o repo na Vercel para deploy automático.

## Deploy público
- Vercel: https://safe-play-poc.vercel.app (projeto `safe-play-poc`, deploy via CLI a partir do container; env NEXT_PUBLIC_* configuradas). Cenário falso positivo validado por E2E contra a URL pública.

## Pendências antigas (v1, superadas)
- Opcional: mover o projeto Supabase para São Paulo (o atual está em us-west-2; latência aceitável, medida acima).
