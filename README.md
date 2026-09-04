# Safe Play · POC acadêmico

Prova de conceito do **Projeto de Impacto do Certificado Profissional em Transformação Digital na Era da IA (MIT Professional Education), Grupo 1**. Demonstra, ao vivo e em três ou mais navegadores, a sequência:

> conversa real → padrão acumulado → risco explicável → alerta parental → revisão humana → auditoria

**Isto não é um produto de proteção infantil em produção.** Todos os dados, personas, códigos e roteiros são sintéticos. Nenhuma decisão punitiva é automática. Nenhum serviço externo (autoridades, pais reais) é contatado.

## Arquitetura

| Camada | Tecnologia | Papel |
| --- | --- | --- |
| Front-end | Next.js 15 (App Router, TS strict), Tailwind 4, Radix | `/demo`, `/play/[roomCode]`, `/guardian/[roomCode]`, `/moderation`, `/audit/[roomCode]` |
| Backend | Supabase Postgres + Auth anônimo + Realtime + RLS | persistência, presença, propagação em tempo real, isolamento por papel |
| Funções | Supabase Edge Functions (Deno) | `send-message`, `join-room`, `demo-control`, `moderation-action` |
| Motor de risco | TypeScript puro em `supabase/functions/_shared/risk` | compartilhado entre Edge Functions e testes (Vitest) |
| IA | Claude (Haiku por padrão) via Edge Function | uma chamada estruturada por análise, apenas quando o orquestrador justifica |

### Pipeline de risco (quatro módulos do deck)

1. **MonitoringAgent**: janela longitudinal (até 40 mensagens com decaimento temporal), janela recente de 12 para LLM/moderação, progressão e recorrência.
2. **CodedLanguageAgent**: glossário sintético versionado (aprovado) + candidatos (heurística e LLM) sujeitos a aprovação humana.
3. **ParentalProtectionAgent**: resumo em linguagem simples e recomendação (`observar | conversar | revisar | acionar_suporte_humano`).
4. **EscalationAgent**: política determinística que abre/atualiza alertas e casos, sem duplicar, com SLA e prioridade.

Score 0–100 → nível `baixo | atencao | alto | critico` (limiares 25/50/75), tendência e sinais estruturados com evidências por ID de mensagem. Uma ocorrência isolada nunca ultrapassa "atenção"; combinações coerentes ganham bônus de sequência.

**Gatilho de LLM** (qualquer um): regra ≥ limiar de atenção; 2+ sinais distintos na janela; N novas mensagens desde a última análise; reanálise do moderador; linha do roteiro marcada. Antes da chamada: orçamento diário, limite por sala, cooldown, cache por hash e circuit breaker. Se não puder chamar, `degraded_mode=true` e o motor determinístico decide sozinho. Resposta validada com Zod, uma tentativa de reparação, depois fallback. A LLM nunca reduz o score abaixo do das regras (postura do deck: errar para o alerta).

## Executar localmente

```bash
pnpm install
cp .env.example .env.local   # preencha NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY
pnpm dev                     # http://localhost:3000
```

Sem Docker, o Supabase local não sobe; use um projeto hospedado (abaixo). Os testes de schema/RLS rodam num Postgres 16 local sem Docker:

```bash
pnpm test        # motor de risco (Vitest)
pnpm db:test     # migrations + RLS em Postgres efêmero (precisa de /usr/lib/postgresql/16)
pnpm lint && pnpm typecheck && pnpm build
```

## Criar o projeto Supabase

1. Crie um projeto (Free) em https://supabase.com/dashboard, região São Paulo.
2. **Authentication → Providers → Anonymous sign-ins: ativar.**
3. Instale o CLI (`npm i -g supabase` ou `npx supabase`) e rode:

```bash
export SUPABASE_ACCESS_TOKEN=<token pessoal>
supabase link --project-ref <ref>
supabase db push                                   # aplica supabase/migrations
supabase secrets set PRESENTER_SECRET=<segredo> ANTHROPIC_API_KEY=<chave> ANTHROPIC_MODEL=claude-haiku-4-5 \
  DAILY_BUDGET_USD=2 ROOM_LLM_CALL_LIMIT=50 LLM_COOLDOWN_SECONDS=15 LLM_MIN_NEW_MESSAGES=3
supabase functions deploy send-message join-room demo-control moderation-action
```

Ou use `scripts/deploy-supabase.sh` (lê as variáveis do ambiente).

4. Em **Database → Publications**, confirme que `supabase_realtime` inclui as tabelas (a migration já adiciona).

## Variáveis de ambiente

| Onde | Nome | Obrigatória | Descrição |
| --- | --- | --- | --- |
| Vercel / `.env.local` | `NEXT_PUBLIC_SUPABASE_URL` | sim | URL do projeto |
| Vercel / `.env.local` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | sim | chave anon/publishable |
| Vercel / `.env.local` | `NEXT_PUBLIC_APP_ENV` | não | rótulo do ambiente |
| Edge Functions (secrets) | `PRESENTER_SECRET` | sim | protege a Central da demo |
| Edge Functions (secrets) | `ANTHROPIC_API_KEY` | não | sem ela, modo degradado por regras |
| Edge Functions (secrets) | `ANTHROPIC_MODEL` | não | padrão `claude-haiku-4-5` |
| Edge Functions (secrets) | `DAILY_BUDGET_USD`, `ROOM_LLM_CALL_LIMIT`, `LLM_COOLDOWN_SECONDS`, `LLM_MIN_NEW_MESSAGES`, `LLM_TIMEOUT_MS`, `LLM_MAX_TOKENS`, `LLM_PRICE_INPUT_PER_M`, `LLM_PRICE_OUTPUT_PER_M` | não | orçamento e preços (padrões: 2, 50, 15, 3, 8000, 700, 1, 5) |
| Playwright | `E2E_PRESENTER_SECRET`, `E2E_BASE_URL`, `PLAYWRIGHT_CHROMIUM_PATH` | para E2E | ver `playwright.config.ts` |

`SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` são injetadas automaticamente nas Edge Functions. A service role nunca vai para o cliente.

## Deploy na Vercel

1. Importe o repositório na Vercel (framework Next.js, sem configuração extra).
2. Defina `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Adicione o domínio da Vercel em **Authentication → URL Configuration → Redirect URLs** (opcional para auth anônimo).

## Testes

```bash
pnpm test                      # unitários do motor (20 testes)
pnpm db:test                   # schema, RLS, triggers, reset (Postgres local)
E2E_PRESENTER_SECRET=<segredo> pnpm test:e2e   # Playwright multi-contexto contra Supabase real
```

Os E2E cobrem: propagação entre navegadores sem refresh, presença e digitação para 3 clientes, cenário progressivo com um único caso, decisão humana refletida no painel do responsável e na auditoria, cenário saudável sem caso, falso positivo descartado sem reabertura, modo degradado com falha forçada e RLS por papel.

## Segurança e privacidade

- Auth anônimo; papéis atribuídos server-side ao resgatar convites (tokens aleatórios, nunca expostos ao cliente).
- Clientes só escrevem `metric_samples` (números) e `alerts.acknowledged_at`. Mensagens passam pela Edge Function (500 caracteres, rate limit 6/10 s por persona, idempotency key).
- RLS: jogador lê só suas salas; responsável só a sala vinculada e mensagens usadas como evidência; moderador só a janela relevante de casos; ninguém altera avaliações, alertas, papéis ou auditoria.
- Auditoria append-only (trigger bloqueia UPDATE/DELETE fora do reset de sessão).
- Sem IP bruto, sem conteúdo integral em logs técnicos.

## Custo estimado da demo

Premissas: Claude Haiku 4.5 (US$ 1/M entrada, US$ 5/M saída), ~1.500 tokens de entrada e ~350 de saída por chamada, cerca de 10 a 14 chamadas no cenário progressivo (cooldown de 15 s e cache por hash reduzem repetições).

| Item | Estimativa |
| --- | --- |
| Uma execução completa do cenário progressivo | ≈ US$ 0,03 a 0,05 |
| Ensaio + apresentação (3 cenários, 3 execuções) | ≈ US$ 0,15 a 0,30 |
| Teto por configuração | US$ 2/dia e 50 chamadas por sala |
| Supabase Free e Vercel Hobby | US$ 0 dentro das cotas |

A Central da demo mostra chamadas, tokens e custo **medidos** pelo ledger, não estimados.

## Limites deste POC (declarados)

- Vocabulário codificado sintético; sem validação contra dataset rotulado; precisão e recall reais não foram medidos.
- Apenas texto e emoji; sem áudio, imagem ou voz.
- Metas do deck (>80% detecção, >90% precisão, <60 min, 100% auditável) são **metas futuras da solução**.
- Análise no servidor (Edge Function), não on-device.
- SLA de demonstração: P1 15 min, P2 60 min, P3 240 min, apenas como contador visual.

## Roteiro de apresentação (5 a 7 minutos) e Plano B

Veja [`docs/roteiro-apresentacao.md`](docs/roteiro-apresentacao.md).

## Identidade visual

Logotipo oficial extraído como PNG com transparência do PDF da proposta (`public/brand`). Substitua por SVG oficial quando houver. Paleta: azul profundo (base), teal/azul luminoso (seguro), laranja (atenção), vermelho (crítico).
