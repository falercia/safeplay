# Safe Play

Prova de conceito do **Projeto de Impacto do Certificado Profissional em Transformação Digital na Era da IA (MIT Professional Education), Grupo 1**: Fabio Garcia, Anderson Lopes, Polyana Resende Brant e Rubiana Enz.

Safe Play demonstra, ao vivo e em vários navegadores, como um jogo online pode detectar padrões longitudinais de risco no chat (aliciamento, pressão para sigilo, pedido de contato fora da plataforma) e transformá-los em alerta explicável para o responsável, revisão humana com justificativa obrigatória e trilha de auditoria:

> conversa real → padrão acumulado → risco explicável → alerta parental → revisão humana → auditoria

**Isto não é um produto de proteção infantil em produção.** Todos os dados, personas, glossário e roteiros são sintéticos. Nenhuma decisão punitiva é automática. Nenhum serviço externo (autoridades, pais reais) é contatado.

## Como a demo funciona

O front-end é um jogo cooperativo simulado, **Arena Nimbus** (canvas 2D, não interativo, assets CC0 da Kenney), com um chat real ao lado. Pessoas reais entram com o próprio nome e um código de acesso, criam um mundo ou entram num mundo aberto, e conversam. O jogo é só o cenário: ele **não reage** ao risco do chat, para que a demonstração deixe claro que a proteção acontece na camada de análise, não na experiência de jogo.

Em rotas separadas, cada papel vê o que lhe cabe:

| Rota | Papel | Acesso | O que mostra |
| --- | --- | --- | --- |
| `/` → `/entrar` → `/lobby` → `/mundo/[código]` | Jogador | nome + código de acesso do jogo | jogo + chat do mundo |
| `/moderacao` | Moderador | código de moderação | fila de casos com SLA, evidências, ações humanas com justificativa, auditoria |
| `/responsavel` | Responsável | código de responsável + mundo | nível de risco em linguagem simples, recomendação, evidências mínimas |
| `/apresentador` | Apresentador | código do apresentador | lista de mundos, avanço do roteiro sintético (3 cenários), métricas, custo medido, Plano B |

Os códigos ficam nos secrets das Edge Functions (`GAME_ACCESS_CODE`, `MODERATOR_CODE`, `GUARDIAN_CODE`, `PRESENTER_SECRET`) e nunca vão para o cliente.

## Arquitetura

| Camada | Tecnologia | Papel |
| --- | --- | --- |
| Front-end | Next.js 15 (App Router, TS strict), Tailwind 4, Radix, canvas 2D | telas por papel, jogo simulado, chat em tempo real |
| Backend | Supabase Postgres + Auth anônimo + Realtime + RLS | persistência, presença, propagação em tempo real, isolamento por papel |
| Funções | Supabase Edge Functions (Deno) | `game-enter`, `world-create`, `world-join`, `role-login`, `send-message`, `demo-control`, `moderation-action` |
| Motor de risco | TypeScript puro em `supabase/functions/_shared/risk` | compartilhado entre Edge Functions e testes (Vitest) |
| IA | Claude (Haiku por padrão) via Edge Function | uma chamada estruturada por análise, apenas quando o orquestrador justifica |
| Deploy | Vercel (front) + Supabase hospedado | https://safe-play-poc.vercel.app |

### Modelo de domínio

Uma **sessão global** agrega tudo. Cada **mundo** (`worlds`, código `W-XXXX`) tem exatamente uma **sala** (`rooms`) e até dois jogadores; o pipeline de risco opera por sala. Perfis são por pessoa (nome livre). A view `world_lobby` alimenta o lobby em tempo real.

### Pipeline de risco (quatro módulos)

1. **MonitoringAgent**: janela longitudinal (até 40 mensagens com decaimento temporal, meia-vida de 30 min), janela recente de 12 para LLM e moderação, progressão e recorrência.
2. **CodedLanguageAgent**: glossário sintético versionado (aprovado) e candidatos (heurística e LLM) sujeitos a aprovação humana.
3. **ParentalProtectionAgent**: resumo em linguagem simples e recomendação (`observar | conversar | revisar | acionar_suporte_humano`).
4. **EscalationAgent**: política determinística que abre ou atualiza alertas e casos, sem duplicar, com SLA e prioridade (P1 15 min, P2 60 min, P3 240 min).

Score 0 a 100 → nível `baixo | atencao | alto | critico` (limiares 25/50/75), tendência e sinais estruturados com evidências por ID de mensagem. Uma ocorrência isolada nunca ultrapassa "atenção"; combinações coerentes e sequências típicas ganham bônus.

**Gatilho de LLM** (qualquer um): regra acima do limiar de atenção; 2+ sinais distintos na janela; N novas mensagens desde a última análise; reanálise do moderador; linha do roteiro marcada. Antes da chamada: orçamento diário, limite por sala, cooldown, cache por hash e circuit breaker. Sem LLM disponível, `degraded_mode=true` e o motor determinístico decide sozinho. Resposta validada com Zod, uma tentativa de reparação, depois fallback. A LLM nunca reduz o score abaixo do das regras (postura do projeto: errar para o alerta).

## Executar localmente

```bash
pnpm install
cp .env.example .env.local   # NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev                     # http://localhost:3000
```

Sem Docker o Supabase local não sobe; use um projeto hospedado (abaixo). Testes:

```bash
pnpm test        # motor de risco (Vitest)
pnpm db:test     # migrations + RLS em Postgres 16 efêmero, sem Docker
pnpm lint && pnpm typecheck && pnpm build
# E2E (Playwright, multi-navegador, contra o Supabase real) em três etapas que compartilham o mundo criado:
export E2E_BASE_URL=https://safe-play-poc.vercel.app E2E_PRESENTER_SECRET=… E2E_GAME_ACCESS_CODE=… E2E_MODERATOR_CODE=… E2E_GUARDIAN_CODE=…
npx playwright test e2e/v2-1-players.spec.ts    # início → entrar → lobby → mundo → chat entre dois navegadores; código errado bloqueado
npx playwright test e2e/v2-2-roteiro.spec.ts    # responsável + moderação + apresentador: roteiro progressivo até Alto e caso único
npx playwright test e2e/v2-3-decisao.spec.ts    # Crítico, decisão humana com justificativa refletida no responsável, encerrar mundo
```

As etapas também geram as capturas de `docs/capturas` (Plano B).

## Supabase

1. Crie um projeto (Free) em https://supabase.com/dashboard.
2. **Authentication → Providers → Anonymous sign-ins: ativar.** Suba o rate limit de logins anônimos (padrão 30/h derruba testes com vários navegadores).
3. Aplique as migrations de `supabase/migrations` (CLI `supabase db push` ou Management API) e publique as funções:

```bash
export SUPABASE_ACCESS_TOKEN=<token pessoal>
supabase link --project-ref <ref>
supabase db push
supabase secrets set PRESENTER_SECRET=<código> GAME_ACCESS_CODE=<código> MODERATOR_CODE=<código> GUARDIAN_CODE=<código> \
  ANTHROPIC_API_KEY=<chave> ANTHROPIC_MODEL=claude-haiku-4-5 DAILY_BUDGET_USD=2 ROOM_LLM_CALL_LIMIT=50 LLM_COOLDOWN_SECONDS=15 LLM_MIN_NEW_MESSAGES=3
supabase functions deploy game-enter world-create world-join role-login send-message demo-control moderation-action
```

## Variáveis de ambiente

| Onde | Nome | Obrigatória | Descrição |
| --- | --- | --- | --- |
| Vercel / `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` | sim | URL do projeto |
| Vercel / `.env.local` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim | chave anon/publishable |
| Vercel / `.env.local` | `NEXT_PUBLIC_APP_ENV` | não | rótulo do ambiente |
| Edge Functions (secrets) | `GAME_ACCESS_CODE`, `MODERATOR_CODE`, `GUARDIAN_CODE`, `PRESENTER_SECRET` | sim | códigos de acesso por papel |
| Edge Functions (secrets) | `ANTHROPIC_API_KEY` | não | sem ela, modo degradado por regras |
| Edge Functions (secrets) | `ANTHROPIC_MODEL` | não | padrão `claude-haiku-4-5` |
| Edge Functions (secrets) | `DAILY_BUDGET_USD`, `ROOM_LLM_CALL_LIMIT`, `LLM_COOLDOWN_SECONDS`, `LLM_MIN_NEW_MESSAGES`, `LLM_TIMEOUT_MS`, `LLM_MAX_TOKENS`, `LLM_PRICE_INPUT_PER_M`, `LLM_PRICE_OUTPUT_PER_M` | não | orçamento e preços (padrões: 2, 50, 15, 3, 8000, 600, 1, 5) |
| Playwright | `E2E_BASE_URL`, `E2E_PRESENTER_SECRET`, `E2E_GAME_ACCESS_CODE`, `E2E_MODERATOR_CODE`, `E2E_GUARDIAN_CODE`, `E2E_STATE_FILE`, `PLAYWRIGHT_CHROMIUM_PATH` | para E2E | ver `playwright.config.ts` e `e2e/helpers.ts` |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente nas Edge Functions. A service role nunca vai para o cliente.

## Deploy na Vercel

Importe o repositório (framework Next.js, sem configuração extra) e defina `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Cada push na branch principal gera um deploy.

## Segurança e privacidade

- Auth anônimo; papéis atribuídos server-side ao validar códigos (nunca expostos ao cliente).
- Clientes só escrevem `metric_samples` (números) e `alerts.acknowledged_at`. Mensagens passam pela Edge Function (500 caracteres, rate limit 6/10 s por perfil, idempotency key).
- RLS: jogador lê só seus mundos; responsável só o mundo vinculado e mensagens usadas como evidência; moderador só a janela relevante de casos; ninguém altera avaliações, alertas, papéis ou auditoria.
- Auditoria append-only (trigger bloqueia UPDATE/DELETE fora do reset).
- Sem IP bruto, sem conteúdo integral em logs técnicos.

## Custo estimado da demo

Premissas: Claude Haiku 4.5 (US$ 1/M entrada, US$ 5/M saída), cerca de 1.500 tokens de entrada e 350 de saída por chamada, 10 a 14 chamadas no cenário progressivo.

| Item | Estimativa |
| --- | --- |
| Uma execução completa do cenário progressivo | ≈ US$ 0,03 a 0,05 |
| Ensaio + apresentação (3 cenários, 3 execuções) | ≈ US$ 0,15 a 0,30 |
| Teto por configuração | US$ 2/dia e 50 chamadas por mundo |
| Supabase Free e Vercel Hobby | US$ 0 dentro das cotas |

A tela do apresentador mostra chamadas, tokens e custo **medidos** pelo ledger, não estimados.

## Limites deste POC (declarados)

- Vocabulário codificado sintético; sem validação contra dataset rotulado; precisão e recall reais não foram medidos.
- Apenas texto e emoji; sem áudio, imagem ou voz.
- Metas do deck (>80% detecção, >90% precisão, <60 min, 100% auditável) são **metas futuras da solução**.
- Análise no servidor (Edge Function), não on-device.
- SLA apenas como contador visual.

## Roteiro de apresentação (5 a 7 minutos) e Plano B

Veja [`docs/roteiro-apresentacao.md`](docs/roteiro-apresentacao.md). Estado atual do projeto em [`docs/STATUS.md`](docs/STATUS.md); decisões do redesign em [`docs/REDESIGN-v2.md`](docs/REDESIGN-v2.md).

## Créditos e licenças

- Logotipo e paleta do Safe Play: azul profundo (base), teal (seguro), laranja (atenção), vermelho (crítico), em `public/brand`.
- Sprites e cenário do jogo: [Kenney](https://kenney.nl), licença CC0 (`public/game/LICENSE.txt`).
