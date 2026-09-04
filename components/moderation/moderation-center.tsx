"use client";

import * as React from "react";
import { AlertOctagon, BookOpen, CheckCircle2, Clock, Filter, Inbox, RadioTower, RefreshCw, Search, ShieldOff, WifiOff, XCircle } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { JoinGate } from "@/components/join-gate";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, LevelBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { SafetyPulse } from "@/components/safety/safety-pulse";
import { TransparencyBody } from "@/components/safety/transparency";
import { useJoin } from "@/lib/hooks/use-join";
import { useLiveTable } from "@/lib/hooks/use-live-table";
import { useRoomIntel } from "@/lib/hooks/use-room-intel";
import { callFunction, ApiError } from "@/lib/api";
import type { CaseActionRow, CaseRow, CaseStatus, GlossaryRow, JoinResult, Level } from "@/lib/types";
import { ACTION_LABEL, CASE_STATUS_LABEL, formatCountdown, formatShortTime, levelClass, signalLabel } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

type ActionKind = CaseActionRow["action"];
const ACTIVE: CaseStatus[] = ["open", "in_review", "needs_context"];

export function ModerationCenter({ token }: { token: string | null }) {
  const join = useJoin(token, "moderator");
  return (
    <JoinGate state={join} roleLabel="Moderador">
      {(data) => <ModerationInner data={data} />}
    </JoinGate>
  );
}

function useNow(intervalMs = 1000) {
  const [now, setNow] = React.useState(() => Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function ModerationInner({ data }: { data: JoinResult }) {
  const { t } = useT();
  const sessionId = data.profile.session_id;
  const now = useNow();
  const cases = useLiveTable<CaseRow>({ table: "cases", filter: { column: "session_id", value: sessionId }, orderBy: { column: "created_at", ascending: false } });
  const [levelFilter, setLevelFilter] = React.useState<Level | "todos">("todos");
  const [statusFilter, setStatusFilter] = React.useState<"ativos" | "resolvidos" | "todos">("ativos");
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const queue = React.useMemo(() => {
    const list = cases.rows.filter((c) => (levelFilter === "todos" ? true : c.level === levelFilter)).filter((c) => (statusFilter === "todos" ? true : statusFilter === "ativos" ? ACTIVE.includes(c.status) : !ACTIVE.includes(c.status)));
    return [...list].sort((a, b) => {
      const aa = ACTIVE.includes(a.status) ? 0 : 1;
      const bb = ACTIVE.includes(b.status) ? 0 : 1;
      if (aa !== bb) return aa - bb;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(a.sla_due_at).getTime() - new Date(b.sla_due_at).getTime();
    });
  }, [cases.rows, levelFilter, statusFilter]);

  React.useEffect(() => {
    if (!selectedId && queue[0]) setSelectedId(queue[0].id);
    if (selectedId && !cases.rows.some((c) => c.id === selectedId) && queue[0]) setSelectedId(queue[0].id);
  }, [queue, selectedId, cases.rows]);

  const selected = cases.rows.find((c) => c.id === selectedId) ?? null;
  const activeCount = cases.rows.filter((c) => ACTIVE.includes(c.status)).length;

  return (
    <AppShell
      role={`${t("role_moderator")}`}
      right={
        <span className={cn("chip", cases.connected ? "text-safe-300" : "text-warn-300")}>
          {cases.connected ? <RadioTower className="size-3.5" /> : <WifiOff className="size-3.5" />}
          <span className="hidden sm:inline">{cases.connected ? "fila ao vivo" : "reconectando"}</span>
        </span>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
        {/* fila */}
        <Card className="flex max-h-[calc(100dvh-9rem)] flex-col">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Inbox className="size-4" /> {t("queue")}
            </CardTitle>
            <Badge>{activeCount} ativo(s)</Badge>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-xs" role="group" aria-label="Filtros">
            <Filter className="size-4 text-ink-400" />
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="focus-ring rounded-lg border border-white/10 bg-navy-900 px-2 py-1" aria-label="Filtrar por status">
              <option value="ativos">Ativos</option>
              <option value="resolvidos">Resolvidos</option>
              <option value="todos">Todos</option>
            </select>
            <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value as typeof levelFilter)} className="focus-ring rounded-lg border border-white/10 bg-navy-900 px-2 py-1" aria-label="Filtrar por nível">
              <option value="todos">Todos os níveis</option>
              <option value="atencao">Atenção</option>
              <option value="alto">Alto</option>
              <option value="critico">Crítico</option>
            </select>
          </div>
          <ul className="scrollbar-thin mt-3 flex flex-1 flex-col gap-2 overflow-y-auto" data-testid="case-queue">
            {cases.loading ? <li className="text-sm text-ink-400">Carregando fila…</li> : null}
            {!cases.loading && queue.length === 0 ? <li className="py-8 text-center text-sm text-ink-400">Fila vazia. Casos aparecem aqui em tempo real.</li> : null}
            {queue.map((c) => {
              const remaining = new Date(c.sla_due_at).getTime() - now;
              const active = ACTIVE.includes(c.status);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={cn("focus-ring w-full rounded-xl border p-3 text-left transition-colors", selectedId === c.id ? "border-sky-400/50 bg-white/8" : "border-white/10 hover:bg-white/5", levelClass(c.level))}
                    data-testid="case-item"
                    data-status={c.status}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-display text-sm font-bold" style={{ color: "var(--lv)" }}>
                        P{c.priority}
                      </span>
                      <LevelBadge level={c.level} size="sm" />
                    </div>
                    <div className="mt-1 text-xs text-ink-300">{CASE_STATUS_LABEL[c.status]}</div>
                    <div className={cn("mt-1 flex items-center gap-1 font-mono text-xs", active ? (remaining < 0 ? "text-crit-400" : remaining < 5 * 60000 ? "text-warn-300" : "text-ink-200") : "text-ink-500")}>
                      <Clock className="size-3.5" /> {active ? `SLA ${formatCountdown(remaining)}` : `resolvido ${c.resolved_at ? formatShortTime(c.resolved_at) : ""}`}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        {/* caso */}
        {selected ? <CaseView key={selected.id} kase={selected} sessionId={sessionId} now={now} /> : <Card className="text-sm text-ink-400">Selecione um caso na fila.</Card>}
      </div>
    </AppShell>
  );
}

function CaseView({ kase, sessionId, now }: { kase: CaseRow; sessionId: string; now: number }) {
  const intel = useRoomIntel(kase.room_id, sessionId);
  const [action, setAction] = React.useState<ActionKind | null>(null);
  const [tab, setTab] = React.useState<"caso" | "auditoria" | "glossario">("caso");
  const glossary = useLiveTable<GlossaryRow>({ table: "glossary_terms", filter: { column: "session_id", value: sessionId }, orderBy: { column: "created_at", ascending: false } });
  const latest = intel.assessments.find((a) => a.id === kase.latest_assessment_id) ?? intel.latest;
  const windowIds = new Set(latest?.window_message_ids ?? []);
  const evidenceIds = new Set((latest?.details?.contributions ?? []).flatMap((c) => c.evidenceMessageIds));
  const windowMessages = intel.messages.filter((m) => windowIds.has(m.id));
  const actions = intel.actions.filter((a) => a.case_id === kase.id);
  const remaining = new Date(kase.sla_due_at).getTime() - now;
  const active = ACTIVE.includes(kase.status);
  const candidates = glossary.rows.filter((g) => g.status === "candidate");

  return (
    <div className="flex flex-col gap-4">
      <Card strong className={levelClass(kase.level)} data-testid="case-view">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-display text-xl font-bold" style={{ color: "var(--lv)" }}>
                Caso P{kase.priority}
              </span>
              <LevelBadge level={kase.level} />
              <Badge>{CASE_STATUS_LABEL[kase.status]}</Badge>
            </div>
            <div className="mt-1 text-xs text-ink-400">
              {kase.id.slice(0, 8)} · motivo: {kase.reason.replace(/_/g, " ")} · aberto {formatShortTime(kase.created_at)}
            </div>
          </div>
          <div className={cn("font-mono text-2xl font-bold", active ? (remaining < 0 ? "text-crit-400" : "text-ink-50") : "text-ink-500")} aria-label="Contador de SLA" data-testid="sla-counter">
            {active ? formatCountdown(remaining) : "—"}
            <div className="text-right text-[10px] font-sans font-normal uppercase tracking-wider text-ink-400">SLA {kase.sla_minutes} min {kase.priority === 2 ? "(meta futura: 60 min)" : ""}</div>
          </div>
        </div>
        <p className="mt-3 text-sm text-ink-200">{latest?.guardian_summary}</p>
        <p className="mt-2 text-xs text-ink-400">Hipótese sujeita a validação humana. Nenhuma ação punitiva é automática; toda decisão exige justificativa e fica na auditoria.</p>

        {/* ações */}
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Ações humanas">
          <Button variant="warn" size="sm" disabled={!active} onClick={() => setAction("confirm_risk")} data-testid="action-confirm">
            <CheckCircle2 /> Confirmar risco
          </Button>
          <Button variant="secondary" size="sm" disabled={!active} onClick={() => setAction("dismiss_false_positive")} data-testid="action-dismiss">
            <XCircle /> Descartar falso positivo
          </Button>
          <Button variant="outline" size="sm" disabled={!active} onClick={() => setAction("request_context")} data-testid="action-context">
            <Search /> Solicitar mais contexto
          </Button>
          <Button variant="danger" size="sm" disabled={!active} onClick={() => setAction("apply_demo_containment")} data-testid="action-contain">
            <ShieldOff /> Contenção temporária (demo)
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAction("reanalyze")}>
            <RefreshCw /> Reanalisar
          </Button>
        </div>
      </Card>

      <div className="flex gap-2 border-b border-white/10 text-sm" role="tablist">
        {(["caso", "auditoria", "glossario"] as const).map((k) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("focus-ring -mb-px border-b-2 px-3 py-2 font-semibold", tab === k ? "border-safe-400 text-ink-50" : "border-transparent text-ink-400")}>
            {k === "caso" ? "Contexto e sinais" : k === "auditoria" ? "Transparência e auditoria" : `Glossário sintético${candidates.length ? ` (${candidates.length})` : ""}`}
          </button>
        ))}
      </div>

      {tab === "caso" ? (
        <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
          <Card>
            <CardTitle>Janela relevante da conversa</CardTitle>
            <p className="mt-1 text-[11px] text-ink-400">Apenas as mensagens usadas na avaliação (RLS limita o acesso à janela), não o histórico completo.</p>
            <ul className="mt-3 flex flex-col gap-1.5" data-testid="case-window">
              {windowMessages.length === 0 ? <li className="text-sm text-ink-400">Carregando janela…</li> : null}
              {windowMessages.map((m) => {
                const sender = intel.profiles.find((p) => p.id === m.sender_profile_id);
                const isEvidence = evidenceIds.has(m.id);
                return (
                  <li key={m.id} className={cn("rounded-lg px-3 py-2 text-xs", isEvidence ? "border border-warn-500/40 bg-warn-500/10" : "bg-white/5")}>
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sky-400">{sender?.display_name ?? "?"}</span>
                      <span className="font-mono text-[10px] text-ink-400">
                        {m.id.slice(0, 8)} · {formatShortTime(m.created_at)}
                      </span>
                    </div>
                    <div className="mt-0.5 text-ink-100">{m.content}</div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <div className="flex flex-col gap-4">
            <Card>
              <CardTitle>Sinais, confiança e divergência</CardTitle>
              <table className="mt-2 w-full text-xs">
                <thead className="text-ink-400">
                  <tr>
                    <th className="py-1 text-left font-medium">Sinal</th>
                    <th className="py-1 text-right font-medium">Conf.</th>
                    <th className="py-1 text-right font-medium">Contrib.</th>
                    <th className="py-1 text-right font-medium">Fonte</th>
                  </tr>
                </thead>
                <tbody>
                  {(latest?.details?.contributions ?? []).map((c) => (
                    <tr key={c.signal} className="border-t border-white/5">
                      <td className="py-1.5">{signalLabel(c.signal)}</td>
                      <td className="py-1.5 text-right">{Math.round(c.confidence * 100)}%</td>
                      <td className="py-1.5 text-right">{c.contribution}</td>
                      <td className="py-1.5 text-right">{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                <Stat label="Regras" value={latest?.rule_score ?? 0} />
                <Stat label="LLM" value={latest?.llm_score ?? "—"} sub={latest?.llm_confidence ? `conf. ${Math.round(latest.llm_confidence * 100)}%` : latest?.degraded ? "degradado" : "não acionada"} />
                <Stat label="Divergência" value={latest?.divergence ? `Δ ${latest.divergence_delta}` : "não"} warn={Boolean(latest?.divergence)} />
              </div>
            </Card>
            <SafetyPulse compact assessments={intel.assessments} latest={latest} kase={kase} />
          </div>
        </div>
      ) : null}

      {tab === "auditoria" ? (
        <Card>
          <TransparencyBody data={{ assessment: latest, job: intel.jobs.find((j) => j.id === latest?.job_id) ?? null, audit: intel.audit, kase, actions }} />
        </Card>
      ) : null}

      {tab === "glossario" ? (
        <Card>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-4" /> Candidatos a código (sintético) · aprovação humana
          </CardTitle>
          <p className="mt-1 text-xs text-ink-400">Termos sugeridos pela heurística ou pela LLM. Só entram no motor após aprovação de uma pessoa, com justificativa.</p>
          {candidates.length === 0 ? (
            <p className="mt-3 text-sm text-ink-400">Nenhum candidato pendente nesta sessão.</p>
          ) : (
            <ul className="mt-3 flex flex-col gap-2">
              {candidates.map((g) => (
                <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 p-3">
                  <div>
                    <div className="text-sm font-semibold">“{g.term}”</div>
                    <div className="text-xs text-ink-400">
                      {g.notes} · proposto por {g.proposed_by}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <ActionWithJustification kase={kase} action="approve_term" payload={{ termId: g.id }} label="Aprovar" variant="primary" />
                    <ActionWithJustification kase={kase} action="reject_term" payload={{ termId: g.id }} label="Rejeitar" variant="outline" />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-4">
            <CardTitle>Termos aprovados nesta sessão</CardTitle>
            <div className="mt-2 flex flex-wrap gap-2">
              {glossary.rows.filter((g) => g.status === "approved").map((g) => (
                <Badge key={g.id}>
                  {g.term} · v{g.version}
                </Badge>
              ))}
              {glossary.rows.filter((g) => g.status === "approved").length === 0 ? <span className="text-xs text-ink-400">Nenhum (a base global sintética v1 continua ativa).</span> : null}
            </div>
          </div>
        </Card>
      ) : null}

      {/* histórico de ações */}
      {actions.length > 0 ? (
        <Card>
          <CardTitle>Decisões humanas registradas</CardTitle>
          <ul className="mt-2 flex flex-col gap-2">
            {actions.map((ac) => (
              <li key={ac.id} className="rounded-lg border border-white/10 p-2.5 text-xs">
                <div className="flex justify-between">
                  <span className="font-semibold">{ACTION_LABEL[ac.action] ?? ac.action}</span>
                  <time className="text-ink-400" dateTime={ac.created_at}>
                    {formatShortTime(ac.created_at)}
                  </time>
                </div>
                <p className="mt-1 text-ink-200">{ac.justification}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ActionDialog kase={kase} action={action} onClose={() => setAction(null)} />
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string | number; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-white/10 p-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-400">{label}</div>
      <div className={cn("font-display text-lg font-bold", warn && "text-warn-300")}>{value}</div>
      {sub ? <div className="text-[10px] text-ink-400">{sub}</div> : null}
    </div>
  );
}

function ActionWithJustification({ kase, action, payload, label, variant }: { kase: CaseRow; action: ActionKind; payload: Record<string, unknown>; label: string; variant: "primary" | "outline" }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button size="sm" variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <ActionDialog kase={kase} action={open ? action : null} payload={payload} onClose={() => setOpen(false)} />
    </>
  );
}

function ActionDialog({ kase, action, payload = {}, onClose }: { kase: CaseRow; action: ActionKind | null; payload?: Record<string, unknown>; onClose: () => void }) {
  const [justification, setJustification] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (action) {
      setJustification("");
      setError(null);
    }
  }, [action]);

  async function submit() {
    if (!action) return;
    if (justification.trim().length < 10) {
      setError("A justificativa é obrigatória (mínimo de 10 caracteres).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await callFunction("moderation-action", { caseId: kase.id, action, justification: justification.trim(), payload });
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? `${e.code}: ${e.message}` : "Falha ao aplicar a ação.");
    } finally {
      setBusy(false);
    }
  }

  const danger = action === "apply_demo_containment";
  return (
    <Dialog open={action !== null} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent title={action ? (ACTION_LABEL[action] ?? action) : ""} description="Registre a justificativa. Ela vai para a trilha de auditoria e para o painel do responsável.">
        {danger ? (
          <div className="flex items-start gap-2 rounded-xl border border-crit-500/40 bg-crit-500/10 p-3 text-xs text-crit-400">
            <AlertOctagon className="mt-0.5 size-4 shrink-0" />
            Contenção temporária de demonstração: pausa o envio de mensagens na sala até nova decisão humana. Não é punição e não afeta nenhuma conta real.
          </div>
        ) : null}
        <label className="text-xs font-semibold text-ink-300" htmlFor="justification">
          Justificativa (obrigatória)
        </label>
        <Textarea id="justification" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Descreva as evidências e o raciocínio humano por trás da decisão…" data-testid="justification" />
        {error ? <p className="text-xs text-warn-300">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} disabled={busy} variant={danger ? "danger" : "primary"} data-testid="confirm-action">
            {busy ? "Aplicando…" : "Confirmar decisão"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
