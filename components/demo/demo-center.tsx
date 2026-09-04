"use client";

import * as React from "react";
import { Activity, Bot, Copy, Database, ExternalLink, KeyRound, LifeBuoy, Play, RadioTower, RefreshCw, RotateCcw, Trash2, Wallet, WifiOff } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, LevelBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLiveTable } from "@/lib/hooks/use-live-table";
import { callFunction, ApiError } from "@/lib/api";
import { isConfigured } from "@/lib/env";
import type { JobRow, Level } from "@/lib/types";
import { degradedReasonLabel, formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ScenarioKey = "saudavel" | "progressivo" | "falso_positivo";

interface DemoStatus {
  session: { id: string; code: string; scenario: ScenarioKey; scriptCursor: number; scriptLength: number; settings: Record<string, unknown>; resetCount: number; createdAt: string };
  scenario: { key: ScenarioKey; title: string; description: string; expectation: string; personas: Record<"A" | "B", { name: string; tagline: string }>; script: { index: number; speaker: "A" | "B"; text: string; note: string | null; forceLlm: boolean }[] };
  room: { id: string; code: string; name: string; safety_level: Level; safety_score: number; contained: boolean; analysis_pending: boolean } | null;
  invites: { role: string; token: string; profileId: string; uses: number; persona: string | null }[];
  metrics: {
    messages: number;
    participantsConnected: number;
    analyses: number;
    fallbacks: number;
    failed: number;
    lastDegradedReason: string | null;
    alertsByLevel: Record<string, number>;
    casesByStatus: Record<string, number>;
    ruleLatencyMs: { p50: number; max: number; n: number } | null;
    llmLatencyMs: { p50: number; max: number; n: number } | null;
    deliveryLatencyMs: { n: number; p50: number | null; max: number | null } | null;
    realtimeConnectMs: { n: number; p50: number | null; max: number | null } | null;
  };
  usage: { calls: number; cachedHits: number; errors: number; inputTokens: number; outputTokens: number; sessionCostUsd: number; dailySpentUsd: number; dailyBudgetUsd: number; dailyRemainingUsd: number; roomCallLimit: number; roomCallsRemaining: number };
  health: { database: string; ai: { configured: boolean; model: string | null; breakerOpenUntil: string | null; failures: number; disabledBySetting: boolean; forceFailure: boolean }; rulesVersion: string; serverTime: string };
}

const SCENARIO_META: Record<ScenarioKey, { title: string; hint: string }> = {
  saudavel: { title: "Conversa saudável", hint: "Sem alerta indevido. Mostra que o sistema não é paranoico." },
  progressivo: { title: "Risco progressivo", hint: "O momento memorável: frases ambíguas viram padrão acumulado, alerta e revisão humana." },
  falso_positivo: { title: "Falso positivo para revisão", hint: "Atenção, caso de baixa prioridade, descarte humano com justificativa." },
};

const PRESENTER_KEY = "safe-play-presenter-code";
const SESSION_KEY = "safe-play-demo-session";

export function DemoCenter() {
  const { t } = useT();
  const [presenterCode, setPresenterCode] = React.useState<string | null>(null);
  const [codeInput, setCodeInput] = React.useState("");
  const [sessionCode, setSessionCode] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<DemoStatus | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastNote, setLastNote] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState<string | null>(null);
  const configured = isConfigured();

  React.useEffect(() => {
    try {
      setPresenterCode(window.sessionStorage.getItem(PRESENTER_KEY));
      setSessionCode(window.localStorage.getItem(SESSION_KEY));
    } catch {
      /* ignore */
    }
  }, []);

  const call = React.useCallback(
    async <T,>(body: Record<string, unknown>, label: string): Promise<T | null> => {
      if (!presenterCode) return null;
      setBusy(label);
      setError(null);
      try {
        return await callFunction<T>("demo-control", body, { presenterCode });
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        if (err?.code === "invalid_presenter_code") {
          setError("Código do apresentador inválido.");
          setPresenterCode(null);
          try {
            window.sessionStorage.removeItem(PRESENTER_KEY);
          } catch {
            /* ignore */
          }
        } else if (err?.code === "session_not_found") {
          setError("Sessão não encontrada (pode ter sido apagada). Crie uma nova.");
          setSessionCode(null);
          setStatus(null);
          try {
            window.localStorage.removeItem(SESSION_KEY);
          } catch {
            /* ignore */
          }
        } else {
          setError(err ? `${err.code}: ${err.message}` : "Falha na Central da demonstração.");
        }
        return null;
      } finally {
        setBusy(null);
      }
    },
    [presenterCode],
  );

  const refresh = React.useCallback(async () => {
    if (!sessionCode || !presenterCode) return;
    const res = await call<{ status: DemoStatus }>({ action: "status", sessionCode }, "status");
    if (res) setStatus(res.status);
  }, [sessionCode, presenterCode, call]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  // atualização ao vivo: jobs/avaliações da sessão disparam refetch do status (sem polling)
  const jobs = useLiveTable<JobRow>({ table: "analysis_jobs", filter: status?.session.id ? { column: "session_id", value: status.session.id } : null, enabled: Boolean(status?.session.id), limit: 1 });
  const refreshTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!status) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 800);
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [jobs.rows, refresh]); // eslint-disable-line react-hooks/exhaustive-deps

  function savePresenter() {
    const v = codeInput.trim();
    if (!v) return;
    try {
      window.sessionStorage.setItem(PRESENTER_KEY, v);
    } catch {
      /* ignore */
    }
    setPresenterCode(v);
  }

  async function create(scenario: ScenarioKey) {
    const res = await call<{ status: DemoStatus }>({ action: "create", scenario }, "create");
    if (res) {
      setStatus(res.status);
      setSessionCode(res.status.session.code);
      setLastNote(null);
      try {
        window.localStorage.setItem(SESSION_KEY, res.status.session.code);
      } catch {
        /* ignore */
      }
    }
  }

  async function reset() {
    if (!sessionCode) return;
    const res = await call<{ status: DemoStatus }>({ action: "reset", sessionCode }, "reset");
    if (res) {
      setStatus(res.status);
      setLastNote(null);
    }
  }

  async function remove() {
    if (!sessionCode) return;
    if (!window.confirm("Apagar a sessão e todos os dados sintéticos? Os links deixam de funcionar.")) return;
    const res = await call<{ ok: true }>({ action: "delete", sessionCode }, "delete");
    if (res) {
      setStatus(null);
      setSessionCode(null);
      try {
        window.localStorage.removeItem(SESSION_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  async function setScenario(scenario: ScenarioKey) {
    if (!sessionCode || scenario === status?.session.scenario) return;
    const res = await call<{ status: DemoStatus }>({ action: "set_scenario", sessionCode, scenario }, "scenario");
    if (res) {
      setStatus(res.status);
      setLastNote(null);
    }
  }

  async function advance() {
    if (!sessionCode) return;
    const res = await call<{ status: DemoStatus; done: boolean; line?: { index: number; speaker: string; note: string | null; forceLlm: boolean } }>({ action: "advance", sessionCode }, "advance");
    if (res) {
      setStatus(res.status);
      setLastNote(res.line?.note ?? (res.done ? "Roteiro concluído." : null));
    }
  }

  async function setSetting(key: "llm_disabled" | "force_llm_failure", value: boolean) {
    if (!sessionCode) return;
    const res = await call<{ status: DemoStatus }>({ action: "set_setting", sessionCode, key, value }, "setting");
    if (res) setStatus(res.status);
  }

  function linkFor(role: string): string | null {
    if (!status?.room) return null;
    const inv = status.invites.find((i) => i.role === role);
    if (!inv) return null;
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    if (role === "moderator") return `${origin}/moderation?t=${inv.token}`;
    if (role === "guardian") return `${origin}/guardian/${status.room.code}?t=${inv.token}`;
    return `${origin}/play/${status.room.code}?t=${inv.token}`;
  }

  async function copy(text: string, key: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      window.prompt("Copie o link:", text);
    }
  }

  if (!configured) {
    return (
      <AppShell role={t("role_presenter")}>
        <Card strong className="mx-auto mt-10 max-w-lg">
          <CardTitle>Configuração pendente</CardTitle>
          <p className="mt-2 text-sm text-ink-200">
            Defina <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> (veja <code>.env.example</code> e o README) para ativar a Central da demonstração.
          </p>
        </Card>
      </AppShell>
    );
  }

  if (!presenterCode) {
    return (
      <AppShell role={t("role_presenter")}>
        <Card strong className="mx-auto mt-10 max-w-md">
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="size-4" /> Código do apresentador
          </CardTitle>
          <p className="mt-2 text-sm text-ink-300">A criação e o controle de sessões são protegidos por um segredo validado no servidor (PRESENTER_SECRET).</p>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              savePresenter();
            }}
          >
            <Input type="password" value={codeInput} onChange={(e) => setCodeInput(e.target.value)} placeholder="Código" aria-label="Código do apresentador" autoComplete="off" data-testid="presenter-code" />
            <Button type="submit" data-testid="presenter-enter">Entrar</Button>
          </form>
          {error ? <p className="mt-2 text-xs text-warn-300">{error}</p> : null}
        </Card>
      </AppShell>
    );
  }

  const ai = status?.health.ai;
  const aiState = !ai ? "?" : !ai.configured ? "sem chave (modo regras)" : ai.disabledBySetting ? "desativada (plano B)" : ai.forceFailure ? "falha forçada (plano B)" : ai.breakerOpenUntil && new Date(ai.breakerOpenUntil) > new Date() ? "circuit breaker aberto" : `pronta · ${ai.model}`;
  const aiOk = Boolean(ai?.configured && !ai.disabledBySetting && !ai.forceFailure && !(ai.breakerOpenUntil && new Date(ai.breakerOpenUntil) > new Date()));

  return (
    <AppShell
      role={t("role_presenter")}
      right={
        <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy !== null || !sessionCode} aria-label="Atualizar status">
          <RefreshCw className={cn(busy === "status" && "animate-spin")} />
        </Button>
      }
    >
      {error ? (
        <div role="alert" className="mb-4 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-2 text-sm text-warn-300">
          {error}
        </div>
      ) : null}

      {!status ? (
        <div className="mx-auto max-w-3xl">
          <h1 className="font-display text-2xl font-bold">{t("demo_center")}</h1>
          <p className="mt-1 text-sm text-ink-300">Escolha o cenário sintético para iniciar uma nova sessão. Os links por papel são gerados em seguida.</p>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {(Object.keys(SCENARIO_META) as ScenarioKey[]).map((k) => (
              <button key={k} type="button" onClick={() => void create(k)} disabled={busy !== null} className="panel focus-ring p-4 text-left transition-colors hover:bg-white/5 disabled:opacity-50" data-testid={`create-${k}`}>
                <div className="font-display font-semibold">{SCENARIO_META[k].title}</div>
                <div className="mt-1 text-xs text-ink-300">{SCENARIO_META[k].hint}</div>
                <div className="mt-3 text-xs font-semibold text-safe-300">{busy === "create" ? "Criando…" : "Iniciar sessão →"}</div>
              </button>
            ))}
          </div>
          {sessionCode ? (
            <p className="mt-6 text-xs text-ink-400">
              Sessão anterior: <code>{sessionCode}</code>. <button type="button" className="underline" onClick={() => void refresh()}>Recarregar</button>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
          {/* coluna esquerda: sessão, links, roteiro */}
          <div className="flex flex-col gap-4">
            <Card strong>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Sessão</CardTitle>
                  <div className="font-display mt-1 text-2xl font-bold" data-testid="session-code">
                    {status.session.code}
                  </div>
                  <div className="text-xs text-ink-400">
                    sala {status.room?.code} · resets {status.session.resetCount} · regras {status.health.rulesVersion}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void reset()} disabled={busy !== null} data-testid="reset-session">
                    <RotateCcw /> Resetar sessão
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy !== null}>
                    <Trash2 /> Apagar
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => { setStatus(null); }} disabled={busy !== null}>
                    Nova sessão
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Cenário">
                {(Object.keys(SCENARIO_META) as ScenarioKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={status.session.scenario === k}
                    onClick={() => void setScenario(k)}
                    disabled={busy !== null}
                    className={cn("focus-ring rounded-xl border p-3 text-left text-sm", status.session.scenario === k ? "border-safe-500/60 bg-safe-500/10" : "border-white/10 hover:bg-white/5")}
                  >
                    <div className="font-semibold">{SCENARIO_META[k].title}</div>
                    <div className="text-[11px] text-ink-400">{SCENARIO_META[k].hint}</div>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-400">Trocar de cenário reseta os dados da sessão; os links continuam válidos.</p>
            </Card>

            <Card>
              <CardTitle>Links por papel</CardTitle>
              <ul className="mt-3 flex flex-col gap-2" data-testid="role-links">
                {[
                  { role: "player", label: `Jogador A · ${status.scenario.personas.A.name}`, idx: 0 },
                  { role: "player", label: `Jogador B · ${status.scenario.personas.B.name}`, idx: 1 },
                  { role: "guardian", label: "Responsável", idx: 0 },
                  { role: "moderator", label: "Moderador", idx: 0 },
                ].map((r) => {
                  const invites = status.invites.filter((i) => i.role === r.role);
                  const inv = invites[r.idx];
                  if (!inv || !status.room) return null;
                  const origin = typeof window !== "undefined" ? window.location.origin : "";
                  const href = r.role === "moderator" ? `${origin}/moderation?t=${inv.token}` : r.role === "guardian" ? `${origin}/guardian/${status.room.code}?t=${inv.token}` : `${origin}/play/${status.room.code}?t=${inv.token}`;
                  const key = `${r.role}-${r.idx}`;
                  return (
                    <li key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-2.5" data-testid={`link-${key}`} data-href={href}>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{r.label}</div>
                        <div className="truncate font-mono text-[10px] text-ink-400">{href.replace(origin, "")}</div>
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => void copy(href, key)} aria-label={`Copiar link ${r.label}`}>
                          <Copy /> {copied === key ? "Copiado" : "Copiar"}
                        </Button>
                        <Button size="sm" variant="secondary" asChild>
                          <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${r.label} em nova aba`}>
                            <ExternalLink /> Abrir
                          </a>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-[11px] text-ink-400">{linkFor("player") ? "Abra cada link em um navegador, janela anônima ou dispositivo diferente." : ""}</p>
            </Card>

            <Card strong>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>Roteiro sintético · {status.scenario.title}</CardTitle>
                  <div className="text-xs text-ink-400">{status.scenario.expectation}</div>
                </div>
                <Button onClick={() => void advance()} disabled={busy !== null || status.session.scriptCursor >= status.session.scriptLength} data-testid="advance">
                  <Play /> {busy === "advance" ? "Enviando e analisando…" : status.session.scriptCursor >= status.session.scriptLength ? "Roteiro concluído" : `Avançar (${status.session.scriptCursor + 1}/${status.session.scriptLength})`}
                </Button>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div className="h-full bg-safe-500 transition-[width]" style={{ width: `${(status.session.scriptCursor / status.session.scriptLength) * 100}%` }} />
              </div>
              {lastNote ? (
                <div className="mt-3 rounded-xl border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-ink-100" data-testid="presenter-note">
                  <span className="font-semibold text-sky-400">Nota do apresentador: </span>
                  {lastNote}
                </div>
              ) : null}
              <ol className="scrollbar-thin mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto text-xs">
                {status.scenario.script.map((l) => {
                  const done = l.index < status.session.scriptCursor;
                  const next = l.index === status.session.scriptCursor;
                  return (
                    <li key={l.index} className={cn("flex gap-2 rounded-lg px-2 py-1.5", next ? "bg-white/8" : done ? "opacity-60" : "opacity-40")}>
                      <span className="w-5 shrink-0 text-right font-mono text-ink-400">{l.index + 1}</span>
                      <span className={cn("w-14 shrink-0 font-semibold", l.speaker === "A" ? "text-safe-300" : "text-warn-300")}>{status.scenario.personas[l.speaker].name}</span>
                      <span className="flex-1 text-ink-100">{l.text}</span>
                      {l.forceLlm ? <Bot className="size-3.5 shrink-0 text-sky-400" aria-label="Análise real solicitada" /> : null}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 text-[11px] text-ink-400">O roteiro insere apenas as mensagens das personas. Alertas, casos e scores são produzidos pelo motor em tempo de execução.</p>
            </Card>
          </div>

          {/* coluna direita: status, uso, métricas, plano B */}
          <div className="flex flex-col gap-4">
            <Card>
              <CardTitle>Status dos serviços</CardTitle>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                <StatusRow icon={Database} label="Supabase (Postgres, Auth, Edge Functions)" ok={status.health.database === "ok"} detail={status.health.database === "ok" ? "ok" : "falha"} />
                <StatusRow icon={jobs.connected ? RadioTower : WifiOff} label="Realtime" ok={jobs.connected} detail={jobs.connected ? "assinado" : "conectando…"} />
                <StatusRow icon={Bot} label="Provedor de IA (Claude via Edge Function)" ok={aiOk} detail={aiState} warn={!aiOk} />
              </ul>
              {status.room ? (
                <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 p-3 text-sm">
                  <span className="text-ink-300">Sala agora</span>
                  <span className="flex items-center gap-2">
                    <LevelBadge level={status.room.safety_level} size="sm" /> <span className="font-display font-bold">{status.room.safety_score}</span>
                    {status.room.analysis_pending ? <span className="animate-pulse-soft text-xs text-sky-400">analisando</span> : null}
                    {status.room.contained ? <Badge className="text-warn-300">contida</Badge> : null}
                  </span>
                </div>
              ) : null}
            </Card>

            <Card>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="size-4" /> Uso e custo (medidos)
              </CardTitle>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <Kpi label="Chamadas LLM" value={status.usage.calls} sub={`${status.usage.cachedHits} cache · ${status.usage.errors} erro(s)`} />
                <Kpi label="Tokens (in/out)" value={`${status.usage.inputTokens}/${status.usage.outputTokens}`} sub="estimados pelo provedor" />
                <Kpi label="Custo da sessão" value={formatUsd(status.usage.sessionCostUsd)} sub={`hoje ${formatUsd(status.usage.dailySpentUsd)}`} />
                <Kpi label="Orçamento restante" value={formatUsd(status.usage.dailyRemainingUsd)} sub={`de ${formatUsd(status.usage.dailyBudgetUsd)}/dia`} warn={status.usage.dailyRemainingUsd < 0.2} />
                <Kpi label="Chamadas restantes" value={status.usage.roomCallsRemaining} sub={`de ${status.usage.roomCallLimit} por sala`} />
                <Kpi label="Modelo" value={ai?.model ?? "—"} sub="configurável por ambiente" small />
              </div>
            </Card>

            <Card>
              <CardTitle className="flex items-center gap-2">
                <Activity className="size-4" /> Métricas do POC (somente medidas)
              </CardTitle>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <Kpi label="Mensagens" value={status.metrics.messages} />
                <Kpi label="Participantes vinculados" value={status.metrics.participantsConnected} sub="personas com navegador" />
                <Kpi label="Análises" value={status.metrics.analyses} sub={`${status.metrics.fallbacks} em fallback · ${status.metrics.failed} falha(s)`} />
                <Kpi label="Latência de entrega" value={status.metrics.deliveryLatencyMs?.p50 !== null && status.metrics.deliveryLatencyMs ? `${status.metrics.deliveryLatencyMs.p50} ms` : "—"} sub={status.metrics.deliveryLatencyMs ? `p50 · máx ${status.metrics.deliveryLatencyMs.max} ms · n=${status.metrics.deliveryLatencyMs.n}` : "envio → realtime"} />
                <Kpi label="Latência da regra" value={status.metrics.ruleLatencyMs ? `${status.metrics.ruleLatencyMs.p50} ms` : "—"} sub={status.metrics.ruleLatencyMs ? `máx ${status.metrics.ruleLatencyMs.max} ms` : ""} />
                <Kpi label="Latência da LLM" value={status.metrics.llmLatencyMs ? `${status.metrics.llmLatencyMs.p50} ms` : "—"} sub={status.metrics.llmLatencyMs ? `máx ${status.metrics.llmLatencyMs.max} ms · n=${status.metrics.llmLatencyMs.n}` : "não acionada"} />
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {(["atencao", "alto", "critico"] as Level[]).map((l) => (
                  <Badge key={l} className={cn("level-badge", `level-${l}`)}>
                    alertas {l}: {status.metrics.alertsByLevel[l] ?? 0}
                  </Badge>
                ))}
                <Badge>casos confirmados: {status.metrics.casesByStatus["confirmed"] ?? 0}</Badge>
                <Badge>descartados: {status.metrics.casesByStatus["dismissed"] ?? 0}</Badge>
                <Badge>abertos: {(status.metrics.casesByStatus["open"] ?? 0) + (status.metrics.casesByStatus["in_review"] ?? 0) + (status.metrics.casesByStatus["needs_context"] ?? 0)}</Badge>
              </div>
              {status.metrics.lastDegradedReason ? <p className="mt-2 text-[11px] text-warn-300">último fallback: {degradedReasonLabel(status.metrics.lastDegradedReason)}</p> : null}
              <p className="mt-2 text-[11px] text-ink-400">Metas do deck (80%, 90%, 95%, SLA de 60 min) são metas futuras da solução, não resultados validados por este POC.</p>
            </Card>

            <Card className="border-warn-500/30">
              <CardTitle className="flex items-center gap-2">
                <LifeBuoy className="size-4" /> Plano B (API externa indisponível)
              </CardTitle>
              <p className="mt-2 text-xs text-ink-300">Se a IA cair, o chat continua e o motor determinístico assume: score, alerta e caso seguem funcionando com a marca “modo degradado”. Use os controles abaixo para demonstrar ao vivo.</p>
              <div className="mt-3 flex flex-col gap-2">
                <Switch checked={Boolean(status.session.settings["llm_disabled"])} onChange={(v) => void setSetting("llm_disabled", v)} label="Desativar LLM nesta sessão (simula chave ausente)" disabled={busy !== null} />
                <Switch checked={Boolean(status.session.settings["force_llm_failure"])} onChange={(v) => void setSetting("force_llm_failure", v)} label="Forçar erro na chamada (simula provedor fora do ar)" disabled={busy !== null} />
              </div>
              <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-300">
                <li>Ative um dos interruptores acima e avance o roteiro: o painel do responsável mostra “modo degradado” e o chat segue normal.</li>
                <li>Se o Supabase cair, use o roteiro impresso do README (seção Plano B) e a captura do Safety Pulse.</li>
                <li>Se a internet cair, rode localmente com <code>pnpm dev</code> apontando para o mesmo projeto Supabase.</li>
              </ol>
            </Card>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function StatusRow({ icon: Icon, label, ok, detail, warn }: { icon: React.ComponentType<{ className?: string }>; label: string; ok: boolean; detail: string; warn?: boolean }) {
  return (
    <li className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-2.5">
      <span className="flex items-center gap-2 text-ink-100">
        <Icon className="size-4 text-ink-300" /> {label}
      </span>
      <span className={cn("chip", ok ? "text-safe-300" : warn ? "text-warn-300" : "text-crit-400")}>
        <span className={cn("size-2 rounded-full", ok ? "bg-safe-400" : warn ? "bg-warn-400" : "bg-crit-500")} aria-hidden /> {detail}
      </span>
    </li>
  );
}

function Kpi({ label, value, sub, warn, small }: { label: string; value: string | number; sub?: string; warn?: boolean; small?: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 p-2.5">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={cn("font-display font-bold", small ? "truncate text-sm" : "text-lg", warn && "text-warn-300")}>{value}</div>
      {sub ? <div className="text-[10px] text-ink-400">{sub}</div> : null}
    </div>
  );
}
