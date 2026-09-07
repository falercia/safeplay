"use client";

import * as React from "react";
import { Activity, Bot, Database, LifeBuoy, LogOut, Play, RadioTower, RefreshCw, RotateCcw, Trash2, Users, Wallet, WifiOff, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { RoleGate } from "@/components/role-gate";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, LevelBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useLiveTable } from "@/lib/hooks/use-live-table";
import { callFunction, ApiError } from "@/lib/api";
import type { JobRow, Level, RoleLoginResult, WorldRow } from "@/lib/types";
import { degradedReasonLabel, formatShortTime, formatUsd } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ScenarioKey = "saudavel" | "progressivo" | "falso_positivo";

interface Health {
  database: string;
  ai: { configured: boolean; model: string | null; breakerOpenUntil: string | null; failures: number; disabledBySetting: boolean; forceFailure: boolean };
  rulesVersion: string;
  serverTime: string;
  settings: Record<string, unknown>;
}

interface WorldSummary {
  id: string;
  code: string;
  name: string;
  status: "open" | "closed";
  created_at: string;
  max_players: number;
  room_id: string;
  players: number;
  player_names: string;
  creator_name: string | null;
  room: { id: string; safety_level: Level; safety_score: number; contained: boolean; analysis_pending: boolean } | null;
}

interface WorldStatus {
  world: { id: string; code: string; name: string; status: string; scenario: ScenarioKey; scriptCursor: number; scriptLength: number; createdAt: string };
  session: { id: string; code: string; settings: Record<string, unknown> };
  scenario: { key: ScenarioKey; title: string; description: string; expectation: string; personas: Record<"A" | "B", { name: string; tagline: string }>; script: { index: number; speaker: "A" | "B"; text: string; note: string | null; forceLlm: boolean }[] };
  room: { id: string; code: string; name: string; safety_level: Level; safety_score: number; contained: boolean; analysis_pending: boolean } | null;
  players: { slot: "A" | "B"; id?: string; display_name?: string }[];
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
  health: Health;
}

const SCENARIO_META: Record<ScenarioKey, { title: string; hint: string }> = {
  saudavel: { title: "Conversa saudável", hint: "Sem alerta indevido. Mostra que o sistema não é paranoico." },
  progressivo: { title: "Risco progressivo", hint: "O momento memorável: frases ambíguas viram padrão acumulado, alerta e revisão humana." },
  falso_positivo: { title: "Falso positivo para revisão", hint: "Atenção, caso de baixa prioridade, descarte humano com justificativa." },
};

const WORLD_KEY = "safe-play:presenter-world";

export function PresenterCenter() {
  return (
    <RoleGate role="presenter" roleLabel="Apresentador" description="A Central da demonstração é protegida por um segredo validado no servidor (PRESENTER_SECRET). Aqui você acompanha os mundos, dispara o roteiro sintético e monitora serviços, uso e custo.">
      {(data, logout, creds) => <PresenterInner data={data} logout={logout} presenterCode={creds.code} />}
    </RoleGate>
  );
}

function PresenterInner({ data, logout, presenterCode }: { data: RoleLoginResult; logout: () => void; presenterCode: string }) {
  const { t } = useT();
  const sessionId = data.profile.session_id;
  const [worlds, setWorlds] = React.useState<WorldSummary[]>([]);
  const [health, setHealth] = React.useState<Health | null>(null);
  const [worldCode, setWorldCode] = React.useState<string | null>(null);
  const [status, setStatus] = React.useState<WorldStatus | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [lastNote, setLastNote] = React.useState<string | null>(null);
  const [showClosed, setShowClosed] = React.useState(false);

  React.useEffect(() => {
    try {
      setWorldCode(window.sessionStorage.getItem(WORLD_KEY));
    } catch {
      /* ignore */
    }
  }, []);

  const call = React.useCallback(
    async <T,>(body: Record<string, unknown>, label: string): Promise<T | null> => {
      const quiet = label === "list" || label === "status"; // leituras não travam os botões
      if (!quiet) {
        setBusy(label);
        setError(null);
      }
      try {
        return await callFunction<T>("demo-control", body, { presenterCode });
      } catch (e) {
        const err = e instanceof ApiError ? e : null;
        if (err?.code === "waiting_second_player") setError("A próxima fala do roteiro é do segundo jogador. Aguarde alguém entrar nesse mundo (ou entre você, em outra janela).");
        else if (err?.code === "world_not_found") {
          setError("Mundo não encontrado (pode ter sido apagado).");
          setWorldCode(null);
          setStatus(null);
        } else setError(err ? `${err.code}: ${err.message}` : "Falha na Central da demonstração.");
        return null;
      } finally {
        if (!quiet) setBusy(null);
      }
    },
    [presenterCode],
  );

  const refreshWorlds = React.useCallback(async () => {
    const res = await call<{ worlds: WorldSummary[]; health: Health }>({ action: "list_worlds" }, "list");
    if (res) {
      setWorlds(res.worlds);
      setHealth(res.health);
    }
  }, [call]);

  const refreshStatus = React.useCallback(async () => {
    if (!worldCode) return;
    const res = await call<{ status: WorldStatus }>({ action: "status", worldCode }, "status");
    if (res) {
      setStatus(res.status);
      setHealth(res.status.health);
    }
  }, [worldCode, call]);

  React.useEffect(() => {
    void refreshWorlds();
  }, [refreshWorlds]);
  React.useEffect(() => {
    setStatus(null);
    setLastNote(null);
    void refreshStatus();
  }, [refreshStatus]);

  // atualização ao vivo: mudanças em mundos/membros/jobs disparam refetch (sem polling)
  const liveWorlds = useLiveTable<WorldRow>({ table: "worlds", filter: { column: "session_id", value: sessionId } });
  const liveJobs = useLiveTable<JobRow>({ table: "analysis_jobs", filter: { column: "session_id", value: sessionId }, orderBy: { column: "created_at", ascending: false }, limit: 1 });
  const liveMembers = useLiveTable<{ room_id: string; profile_id: string }>({ table: "room_members", filter: null, select: "room_id, profile_id", rowKey: (r) => `${r.room_id}:${r.profile_id}` });
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void refreshWorlds();
      void refreshStatus();
    }, 700);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [liveWorlds.rows, liveJobs.rows, liveMembers.rows.length, refreshWorlds, refreshStatus]);

  function selectWorld(code: string | null) {
    setWorldCode(code);
    try {
      if (code) window.sessionStorage.setItem(WORLD_KEY, code);
      else window.sessionStorage.removeItem(WORLD_KEY);
    } catch {
      /* ignore */
    }
  }

  async function advance() {
    if (!worldCode) return;
    const res = await call<{ status: WorldStatus; done: boolean; skipped?: boolean; line?: { index: number; speaker: string; note: string | null; forceLlm: boolean } }>({ action: "advance", worldCode }, "advance");
    if (res) {
      setStatus(res.status);
      setLastNote(res.line?.note ?? (res.done ? "Roteiro concluído." : null));
    }
  }
  async function setScenario(scenario: ScenarioKey) {
    if (!worldCode || scenario === status?.world.scenario) return;
    const res = await call<{ status: WorldStatus }>({ action: "set_scenario", worldCode, scenario }, "scenario");
    if (res) {
      setStatus(res.status);
      setLastNote(null);
    }
  }
  async function reset() {
    if (!worldCode) return;
    const res = await call<{ status: WorldStatus }>({ action: "reset_world", worldCode }, "reset");
    if (res) {
      setStatus(res.status);
      setLastNote(null);
    }
  }
  async function close() {
    if (!worldCode) return;
    if (!window.confirm("Encerrar este mundo? Os jogadores não conseguem mais entrar nele (os dados ficam para consulta).")) return;
    const res = await call<{ ok: true }>({ action: "close_world", worldCode }, "close");
    if (res) {
      selectWorld(null);
      setStatus(null);
      void refreshWorlds();
    }
  }
  async function remove() {
    if (!worldCode) return;
    if (!window.confirm("Apagar este mundo e todos os seus dados (mensagens, avaliações, casos, auditoria)? Não dá para desfazer.")) return;
    const res = await call<{ ok: true }>({ action: "delete_world", worldCode }, "delete");
    if (res) {
      selectWorld(null);
      setStatus(null);
      void refreshWorlds();
    }
  }
  async function purgeClosed() {
    const n = worlds.filter((w) => w.status === "closed").length;
    if (n === 0) return;
    if (!window.confirm(`Apagar os ${n} mundo(s) encerrado(s) e todos os seus dados? Limpa a fila de moderação. Não dá para desfazer.`)) return;
    const res = await call<{ purged: number }>({ action: "purge_closed" }, "purge");
    if (res) void refreshWorlds();
  }
  async function setSetting(key: "llm_disabled" | "force_llm_failure", value: boolean) {
    const res = await call<{ health: Health }>({ action: "set_setting", key, value }, "setting");
    if (res) {
      setHealth(res.health);
      void refreshStatus();
    }
  }

  const ai = health?.ai;
  const breakerOpen = Boolean(ai?.breakerOpenUntil && new Date(ai.breakerOpenUntil) > new Date());
  const aiState = !ai ? "consultando…" : !ai.configured ? "sem chave (modo regras)" : ai.disabledBySetting ? "desativada (plano B)" : ai.forceFailure ? "falha forçada (plano B)" : breakerOpen ? "circuit breaker aberto" : `pronta · ${ai.model}`;
  const aiOk = Boolean(ai?.configured && !ai.disabledBySetting && !ai.forceFailure && !breakerOpen);
  const realtimeOk = liveWorlds.connected && liveJobs.connected;
  const settings = health?.settings ?? status?.session.settings ?? {};

  return (
    <AppShell
      role={t("role_presenter")}
      right={
        <>
          <Button variant="ghost" size="sm" onClick={() => { void refreshWorlds(); void refreshStatus(); }} disabled={busy !== null} aria-label="Atualizar">
            <RefreshCw className={cn(busy === "status" && "animate-spin")} />
          </Button>
          <Button variant="ghost" size="sm" onClick={logout} aria-label="Sair">
            <LogOut />
          </Button>
        </>
      }
    >
      {error ? (
        <div role="alert" className="mb-4 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-2 text-sm text-warn-300">
          {error}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[1.2fr_1fr]">
        {/* coluna esquerda: mundos e roteiro */}
        <div className="flex flex-col gap-4">
          <Card strong>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-4" /> Mundos ativos
                </CardTitle>
                <div className="text-xs text-ink-400">Jogadores reais criam mundos na tela inicial. Escolha um para operar o roteiro.</div>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{worlds.filter((w) => w.status === "open").length} aberto(s)</Badge>
                <button type="button" onClick={() => setShowClosed((v) => !v)} className="focus-ring chip hover:bg-white/10">
                  {showClosed ? "ocultar encerrados" : `mostrar encerrados (${worlds.filter((w) => w.status === "closed").length})`}
                </button>
                <button type="button" onClick={() => void purgeClosed()} disabled={busy !== null || worlds.every((w) => w.status !== "closed")} className="focus-ring chip text-crit-400 hover:bg-white/10 disabled:opacity-40">
                  <Trash2 className="size-3.5" /> apagar encerrados
                </button>
              </div>
            </div>
            <ul className="mt-3 flex flex-col gap-2" data-testid="presenter-worlds">
              {worlds.length === 0 ? <li className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-ink-400">Nenhum mundo ainda. Abra a tela inicial em outra janela, entre com nome + código e crie um mundo.</li> : null}
              {worlds.filter((w) => showClosed || w.status === "open").map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => selectWorld(w.code)}
                    disabled={w.status === "closed"}
                    className={cn("focus-ring flex w-full items-center justify-between gap-3 rounded-xl border p-3 text-left text-sm transition-colors disabled:opacity-50", worldCode === w.code ? "border-safe-500/60 bg-safe-500/10" : "border-white/10 hover:bg-white/5")}
                    data-testid="presenter-world"
                    data-code={w.code}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-semibold">
                        {w.name} <span className="font-mono text-[11px] font-normal text-ink-400">{w.code}</span>
                        {w.status === "closed" ? <span className="chip ml-2 text-ink-400">encerrado</span> : null}
                      </div>
                      <div className="text-[11px] text-ink-400">
                        {w.players}/{w.max_players} · {w.player_names || "vazio"} · {formatShortTime(w.created_at)}
                      </div>
                    </div>
                    {w.room ? (
                      <span className="flex items-center gap-2">
                        <LevelBadge level={w.room.safety_level} size="sm" /> <span className="font-display font-bold">{w.room.safety_score}</span>
                        {w.room.analysis_pending ? <span className="animate-pulse-soft text-xs text-sky-400">analisando</span> : null}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          {status ? (
            <Card strong>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle>
                    {status.world.name} <span className="font-mono text-xs font-normal text-ink-400">{status.world.code}</span>
                  </CardTitle>
                  <div className="text-xs text-ink-400">
                    jogadores: {status.players.map((p) => `${p.slot} = ${p.display_name ?? "?"}`).join(" · ") || "nenhum"} · regras {status.health.rulesVersion}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => void reset()} disabled={busy !== null} data-testid="reset-world">
                    <RotateCcw /> Zerar dados
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void close()} disabled={busy !== null}>
                    <XCircle /> Encerrar mundo
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void remove()} disabled={busy !== null} className="text-crit-400">
                    <Trash2 /> Apagar
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Cenário">
                {(Object.keys(SCENARIO_META) as ScenarioKey[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={status.world.scenario === k}
                    onClick={() => void setScenario(k)}
                    disabled={busy !== null}
                    className={cn("focus-ring rounded-xl border p-3 text-left text-sm", status.world.scenario === k ? "border-safe-500/60 bg-safe-500/10" : "border-white/10 hover:bg-white/5")}
                    data-testid={`scenario-${k}`}
                  >
                    <div className="font-semibold">{SCENARIO_META[k].title}</div>
                    <div className="text-[11px] text-ink-400">{SCENARIO_META[k].hint}</div>
                  </button>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-400">Trocar de cenário reinicia o roteiro deste mundo (as mensagens já enviadas permanecem; use “Zerar dados” para limpar).</p>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="font-display text-sm font-semibold">Roteiro sintético · {status.scenario.title}</div>
                  <div className="text-xs text-ink-400">{status.scenario.expectation}</div>
                </div>
                <Button onClick={() => void advance()} disabled={busy !== null || status.world.scriptCursor >= status.world.scriptLength} data-testid="advance">
                  <Play /> {busy === "advance" ? "Enviando e analisando…" : status.world.scriptCursor >= status.world.scriptLength ? "Roteiro concluído" : `Avançar (${status.world.scriptCursor + 1}/${status.world.scriptLength})`}
                </Button>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div className="h-full bg-safe-500 transition-[width]" style={{ width: `${(status.world.scriptCursor / status.world.scriptLength) * 100}%` }} />
              </div>
              {lastNote ? (
                <div className="mt-3 rounded-xl border border-sky-400/30 bg-sky-400/10 p-3 text-sm text-ink-100" data-testid="presenter-note">
                  <span className="font-semibold text-sky-400">Nota do apresentador: </span>
                  {lastNote}
                </div>
              ) : null}
              <ol className="scrollbar-thin mt-3 flex max-h-72 flex-col gap-1 overflow-y-auto text-xs">
                {status.scenario.script.map((l) => {
                  const done = l.index < status.world.scriptCursor;
                  const next = l.index === status.world.scriptCursor;
                  const who = status.players.find((p) => p.slot === l.speaker)?.display_name ?? status.scenario.personas[l.speaker].name;
                  return (
                    <li key={l.index} className={cn("flex gap-2 rounded-lg px-2 py-1.5", next ? "bg-white/8" : done ? "opacity-60" : "opacity-40")}>
                      <span className="w-5 shrink-0 text-right font-mono text-ink-400">{l.index + 1}</span>
                      <span className={cn("w-20 shrink-0 truncate font-semibold", l.speaker === "A" ? "text-safe-300" : "text-warn-300")}>{who}</span>
                      <span className="flex-1 text-ink-100">{l.text}</span>
                      {l.forceLlm ? <Bot className="size-3.5 shrink-0 text-sky-400" aria-label="Análise real solicitada" /> : null}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 text-[11px] text-ink-400">As falas entram no chat como se fossem dos dois jogadores do mundo (A = quem criou, B = quem entrou depois). Alertas, casos e scores são produzidos pelo motor em tempo de execução.</p>
            </Card>
          ) : worldCode ? (
            <Card className="text-sm text-ink-400">Carregando o mundo {worldCode}…</Card>
          ) : (
            <Card className="text-sm text-ink-400">Selecione um mundo acima para ver o roteiro, as métricas e o custo.</Card>
          )}
        </div>

        {/* coluna direita: status, uso, métricas, plano B */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardTitle>Status dos serviços</CardTitle>
            <ul className="mt-3 flex flex-col gap-2 text-sm">
              <StatusRow icon={Database} label="Supabase (Postgres, Auth, Edge Functions)" ok={health?.database === "ok"} detail={health ? (health.database === "ok" ? "ok" : "falha") : "consultando…"} warn={!health} />
              <StatusRow icon={realtimeOk ? RadioTower : WifiOff} label="Realtime" ok={realtimeOk} detail={realtimeOk ? "assinado" : "conectando…"} warn />
              <StatusRow icon={Bot} label="Provedor de IA (Claude via Edge Function)" ok={aiOk} detail={aiState} warn={!aiOk} />
            </ul>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <Kpi label="Modelo" value={ai?.model ?? "—"} sub="configurável por ambiente" small />
              <Kpi label="Regras" value={health?.rulesVersion ?? "—"} sub={health ? `servidor ${formatShortTime(health.serverTime)}` : ""} small />
            </div>
            {status?.room ? (
              <div className="mt-3 flex items-center justify-between rounded-xl border border-white/10 p-3 text-sm">
                <span className="text-ink-300">Mundo agora</span>
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
            {status ? (
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                <Kpi label="Chamadas LLM" value={status.usage.calls} sub={`${status.usage.cachedHits} cache · ${status.usage.errors} erro(s)`} />
                <Kpi label="Tokens (in/out)" value={`${status.usage.inputTokens}/${status.usage.outputTokens}`} sub="informados pelo provedor" />
                <Kpi label="Custo do mundo" value={formatUsd(status.usage.sessionCostUsd)} sub={`hoje ${formatUsd(status.usage.dailySpentUsd)}`} />
                <Kpi label="Orçamento restante" value={formatUsd(status.usage.dailyRemainingUsd)} sub={`de ${formatUsd(status.usage.dailyBudgetUsd)}/dia`} warn={status.usage.dailyRemainingUsd < 0.2} />
                <Kpi label="Chamadas restantes" value={status.usage.roomCallsRemaining} sub={`de ${status.usage.roomCallLimit} por mundo`} />
                <Kpi label="Modelo" value={ai?.model ?? "—"} small />
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-400">Selecione um mundo.</p>
            )}
          </Card>

          <Card>
            <CardTitle className="flex items-center gap-2">
              <Activity className="size-4" /> Métricas do POC (somente medidas)
            </CardTitle>
            {status ? (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  <Kpi label="Mensagens" value={status.metrics.messages} />
                  <Kpi label="Jogadores no mundo" value={status.metrics.participantsConnected} />
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
              </>
            ) : (
              <p className="mt-2 text-xs text-ink-400">Selecione um mundo.</p>
            )}
            <p className="mt-2 text-[11px] text-ink-400">Metas do deck (80%, 90%, 95%, SLA de 60 min) são metas futuras da solução, não resultados validados por este POC.</p>
          </Card>

          <Card className="border-warn-500/30">
            <CardTitle className="flex items-center gap-2">
              <LifeBuoy className="size-4" /> Plano B (API externa indisponível)
            </CardTitle>
            <p className="mt-2 text-xs text-ink-300">Se a IA cair, o chat continua e o motor determinístico assume: score, alerta e caso seguem funcionando com a marca “modo degradado”. Os interruptores valem para todos os mundos.</p>
            <div className="mt-3 flex flex-col gap-2">
              <Switch checked={Boolean(settings["llm_disabled"])} onChange={(v) => void setSetting("llm_disabled", v)} label="Desativar LLM (simula chave ausente)" disabled={busy !== null} />
              <Switch checked={Boolean(settings["force_llm_failure"])} onChange={(v) => void setSetting("force_llm_failure", v)} label="Forçar erro na chamada (simula provedor fora do ar)" disabled={busy !== null} />
            </div>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-ink-300">
              <li>Ative um dos interruptores e avance o roteiro: o painel do responsável mostra “modo degradado” e o chat segue normal.</li>
              <li>Se o Supabase cair, use o roteiro impresso (docs/roteiro-apresentacao.md) e as capturas de tela.</li>
              <li>Se a internet cair, rode localmente com <code>pnpm dev</code> apontando para o mesmo projeto Supabase.</li>
            </ol>
          </Card>
        </div>
      </div>
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
