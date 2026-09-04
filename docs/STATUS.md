# Estado do projeto · 2026-09-04 (fim da sessão 1)

## Pronto e verificado
- Motor de risco, schema/RLS, Edge Functions, front-end: lint, typecheck, build, 20 testes unitários e testes SQL passando.
- Projeto Supabase `ygwfghnwgqrzfwibmnwr` (região us-west-2): 5 migrations aplicadas, 4 Edge Functions publicadas, secrets configurados (PRESENTER_SECRET, ANTHROPIC_API_KEY, modelo claude-haiku-4-5, orçamento US$ 2/dia, 50 chamadas/sala).
- Login anônimo ativo; limite de logins anônimos elevado para 300/hora por IP (padrão 30 derrubava os testes).
- E2E Playwright executados contra o Supabase real, a partir do Mac (5 specs: progressivo em 5 contextos, saudável, falso positivo, degradado, RLS): **todos passando**. Entrega medida: 872 ms (caminho quente), 1,9 s (cold start da função).

## Como retomar
1. Repositório: pasta do projeto → `safe-play/` (git, último commit `aad0943`). `pnpm install`, `.env.local` já contém URL e anon key.
2. Rodar local: `pnpm dev` → http://localhost:3000/demo. Código do apresentador: ver secret `PRESENTER_SECRET` no Supabase (Edge Functions → Secrets) ou pedir ao Claude (guardado fora do repo).
3. E2E: `E2E_PRESENTER_SECRET=<código> E2E_BASE_URL=http://localhost:3000 pnpm test:e2e` com o servidor rodando (`pnpm build && pnpm start`).
4. Capturas para o Plano B: `PW_TEST_DIR=./scripts npx playwright test capture.spec.ts` (ainda não geradas).

## Pendências
- Deploy na Vercel (aguardando autorização/token ou importação do repositório pelo Fabio).
- Gerar `docs/capturas` (script pronto).
- Ensaio final do roteiro (docs/roteiro-apresentacao.md) com três janelas.
- Opcional: mover o projeto Supabase para São Paulo (o atual está em us-west-2; latência aceitável, medida acima).
