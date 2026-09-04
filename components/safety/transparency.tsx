"use client";

import * as React from "react";
import { Info } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { AssessmentRow, AuditRow, CaseActionRow, CaseRow, JobRow } from "@/lib/types";
import { ACTION_LABEL, degradedReasonLabel, formatTime, signalLabel, TRIGGER_REASON_LABEL } from "@/lib/format";
import { useT } from "@/lib/i18n";

export interface TransparencyData {
  assessment: AssessmentRow | null;
  job: JobRow | null;
  audit: AuditRow[];
  kase: CaseRow | null;
  actions: CaseActionRow[];
}

/** Drawer de transparência: explicação por evidências, nunca cadeia de pensamento do modelo. */
export function TransparencyDrawer({ open, onOpenChange, data }: { open: boolean; onOpenChange: (v: boolean) => void; data: TransparencyData }) {
  const { t } = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title={t("transparency")} description="O que iniciou a análise, quais mensagens foram consideradas, quais sinais foram observados e quem decidiu.">
        <TransparencyBody data={data} />
      </DialogContent>
    </Dialog>
  );
}

export function TransparencyBody({ data }: { data: TransparencyData }) {
  const { assessment: a, job, kase, actions } = data;
  const analysisEvent = data.audit.find((e) => e.event_type === "analysis.completed" && (a ? e.payload["assessment_id"] === a.id : true)) ?? null;
  const payload = (analysisEvent?.payload ?? {}) as Record<string, unknown>;

  return (
    <div className="flex flex-col gap-5 text-sm" data-testid="transparency-body">
      <div className="rounded-xl border border-sky-400/30 bg-sky-400/10 p-3 text-xs text-ink-100">
        <Info className="mr-1 inline size-3.5 text-sky-400" />
        Explicação baseada em evidências (IDs de mensagens e sinais observáveis), não em cadeia de pensamento do modelo.
      </div>

      {!a ? (
        <p className="text-ink-400">Ainda não há avaliação para explicar.</p>
      ) : (
        <>
          <Section title="Evento que iniciou a análise">
            <Row k="Gatilho" v={String(payload["trigger"] ?? job?.trigger_type ?? a.details.triggerType ?? "mensagem")} />
            <Row k="Mensagem gatilho" v={String(payload["trigger_message_id"] ?? job?.trigger_message_id ?? "—")} mono />
            <Row k="Horário" v={formatTime(a.created_at)} />
            <Row k="Job" v={a.job_id ?? "—"} mono />
          </Section>

          <Section title="IDs das mensagens usadas (janela)">
            <div className="flex flex-wrap gap-1">
              {a.window_message_ids.map((id) => (
                <code key={id} className="rounded bg-white/5 px-1.5 py-0.5 text-[11px] text-ink-200">
                  {id.slice(0, 8)}
                </code>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-ink-400">Análise longitudinal: até 40 mensagens com decaimento temporal; janela recente de {a.window_message_ids.length} mensagens.</p>
          </Section>

          <Section title="Sinais observáveis">
            {a.details.contributions.length === 0 ? (
              <p className="text-ink-400">Nenhum sinal.</p>
            ) : (
              <table className="w-full text-xs">
                <thead className="text-ink-400">
                  <tr>
                    <th className="py-1 text-left font-medium">Sinal</th>
                    <th className="py-1 text-right font-medium">Ocorr.</th>
                    <th className="py-1 text-right font-medium">Contrib.</th>
                    <th className="py-1 text-right font-medium">Fonte</th>
                    <th className="py-1 text-left font-medium">Evidências</th>
                  </tr>
                </thead>
                <tbody>
                  {a.details.contributions.map((c) => (
                    <tr key={c.signal} className="border-t border-white/5">
                      <td className="py-1.5">{signalLabel(c.signal)}</td>
                      <td className="py-1.5 text-right">{c.occurrences}</td>
                      <td className="py-1.5 text-right">{c.contribution}</td>
                      <td className="py-1.5 text-right">{c.source}</td>
                      <td className="py-1.5 font-mono text-[10px] text-ink-300">{c.evidenceMessageIds.map((id) => id.slice(0, 8)).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-300">
              <Badge>combinação +{a.details.combinationBonus}</Badge>
              <Badge>sequência +{a.details.sequenceBonus}</Badge>
              {a.details.capApplied ? <Badge>limite aplicado: {a.details.capApplied}</Badge> : null}
              <Badge>score regras {a.rule_score}</Badge>
              {a.llm_score !== null ? <Badge>score LLM {a.llm_score} (confiança {a.llm_confidence ?? "—"})</Badge> : null}
              <Badge>final {a.score}</Badge>
            </div>
          </Section>

          <Section title="Motor e modelo">
            <Row k="Versão das regras" v={a.rules_version} mono />
            <Row k="Glossário sintético" v={`v${a.details.glossaryVersion}`} />
            <Row k="Modelo" v={a.model ?? "não acionado"} mono />
            <Row k="Método" v={a.method} />
            <Row k="Gatilhos da LLM" v={a.details.llmTriggerReasons.length ? a.details.llmTriggerReasons.map((r) => TRIGGER_REASON_LABEL[r] ?? r).join("; ") : "nenhum"} />
            <Row k="Latência das regras" v={job?.rule_latency_ms !== null && job?.rule_latency_ms !== undefined ? `${job.rule_latency_ms} ms` : "—"} />
            <Row k="Latência da LLM" v={job?.llm_latency_ms ? `${job.llm_latency_ms} ms` : a.details.cached ? "cache" : "—"} />
            <Row k="Latência total" v={analysisEvent?.latency_ms !== null && analysisEvent?.latency_ms !== undefined ? `${analysisEvent.latency_ms} ms` : "—"} />
          </Section>

          <Section title="Ação recomendada (automática, não punitiva)">
            <Row k="Recomendação" v={a.recommendation.replace(/_/g, " ")} />
            <Row k="Política" v={String(payload["recommended_action"] ?? "—").replace(/_/g, " ")} />
            <Row k="Divergência regra × LLM" v={a.divergence ? `sim (Δ ${a.divergence_delta})` : "não"} />
          </Section>

          <Section title="Fallback / degradação">
            <Row k="Estado" v={a.degraded ? `modo degradado: ${degradedReasonLabel(a.details.degradedReason)}` : "normal"} />
            {a.details.budgetReason ? <Row k="Guarda de orçamento" v={degradedReasonLabel(a.details.budgetReason)} /> : null}
          </Section>
        </>
      )}

      <Section title="Decisão humana e justificativa">
        {!kase ? (
          <p className="text-ink-400">Nenhum caso aberto para esta sala.</p>
        ) : actions.length === 0 ? (
          <p className="text-ink-400">Caso {kase.id.slice(0, 8)} aguardando decisão humana (status: {kase.status}).</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {actions.map((ac) => (
              <li key={ac.id} className="rounded-lg border border-white/10 p-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-ink-50">{ACTION_LABEL[ac.action] ?? ac.action}</span>
                  <time className="text-ink-400" dateTime={ac.created_at}>
                    {formatTime(ac.created_at)}
                  </time>
                </div>
                <p className="mt-1 text-xs text-ink-200">{ac.justification}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Trilha de auditoria (append-only)">
        {data.audit.length === 0 ? (
          <p className="text-ink-400">Sem eventos.</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-xs">
            {data.audit.slice(0, 40).map((e) => (
              <li key={e.id} className="flex items-start gap-2 border-t border-white/5 py-1.5">
                <time className="w-[70px] shrink-0 font-mono text-[10px] text-ink-400" dateTime={e.created_at}>
                  {formatTime(e.created_at)}
                </time>
                <span className="w-16 shrink-0 text-ink-400">{e.actor_type}</span>
                <span className="text-ink-100">{e.event_type}</span>
                {e.model ? <span className="text-ink-400">· {e.model}</span> : null}
                {e.rules_version ? <span className="text-ink-400">· {e.rules_version}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h4 className="font-display mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-300">{title}</h4>
      <div className="rounded-xl border border-white/10 p-3">{children}</div>
    </section>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-0.5 text-xs">
      <span className="text-ink-400">{k}</span>
      <span className={mono ? "break-all text-right font-mono text-[11px] text-ink-100" : "text-right text-ink-100"}>{v}</span>
    </div>
  );
}
