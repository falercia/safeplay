"use client";

import * as React from "react";
import { Bell, BellRing, Eye, HeartHandshake, MessageCircle, RadioTower, ShieldAlert, WifiOff } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { JoinGate } from "@/components/join-gate";
import { Card, CardTitle } from "@/components/ui/card";
import { Badge, LevelBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SafetyPulse } from "@/components/safety/safety-pulse";
import { TransparencyDrawer } from "@/components/safety/transparency";
import { useJoin } from "@/lib/hooks/use-join";
import { useRoomIntel } from "@/lib/hooks/use-room-intel";
import { getSupabase } from "@/lib/supabase/client";
import type { JoinResult, Level, Recommendation } from "@/lib/types";
import { ACTION_LABEL, CASE_STATUS_LABEL, formatShortTime, levelClass, levelLabel, recommendationDetail, recommendationLabel, signalLabel, signalPlain } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const RECO_ICON: Record<Recommendation, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  observar: Eye,
  conversar: MessageCircle,
  revisar: ShieldAlert,
  acionar_suporte_humano: HeartHandshake,
};

export function GuardianPanel({ roomCode, token }: { roomCode: string; token: string | null }) {
  const join = useJoin(token, "guardian");
  return (
    <JoinGate state={join} roleLabel="Responsável">
      {(data) => <GuardianInner data={data} roomCode={roomCode} />}
    </JoinGate>
  );
}

function GuardianInner({ data }: { data: JoinResult; roomCode: string }) {
  const { t } = useT();
  const roomId = data.room?.id ?? null;
  const intel = useRoomIntel(roomId, data.profile.session_id);
  const [explainOpen, setExplainOpen] = React.useState(false);
  const [toast, setToast] = React.useState<{ level: Level; title: string } | null>(null);
  const seenAlerts = React.useRef<Set<string>>(new Set());
  const firstLoad = React.useRef(true);

  // alerta ao vivo: toast para alertas novos após a carga inicial
  React.useEffect(() => {
    if (intel.alerts.length === 0) return;
    if (firstLoad.current) {
      for (const a of intel.alerts) seenAlerts.current.add(a.id);
      firstLoad.current = false;
      return;
    }
    const fresh = intel.alerts.find((a) => !seenAlerts.current.has(a.id));
    if (fresh) {
      seenAlerts.current.add(fresh.id);
      setToast({ level: fresh.level, title: fresh.title });
      const id = setTimeout(() => setToast(null), 6000);
      return () => clearTimeout(id);
    }
  }, [intel.alerts]);

  const level: Level = intel.latest?.level ?? intel.room?.safety_level ?? "baixo";
  const reco: Recommendation = intel.latest?.recommendation ?? "observar";
  const RecoIcon = RECO_ICON[reco];
  const ward = intel.profiles.find((p) => p.persona_key === "A");
  const other = intel.profiles.find((p) => p.persona_key === "B");
  const evidence = React.useMemo(() => {
    const ids = new Set(intel.signals.filter((s) => s.assessment_id === intel.latest?.id).flatMap((s) => s.evidence_message_ids));
    return intel.messages.filter((m) => ids.has(m.id));
  }, [intel.signals, intel.messages, intel.latest?.id]);
  const signalsForGuardian = (intel.latest?.details?.contributions ?? []).filter((c) => c.contribution > 0).slice(0, 5);
  const humanActions = intel.actions.filter((a) => intel.activeCase && a.case_id === intel.activeCase.id);

  async function acknowledge(id: string) {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from("alerts").update({ acknowledged_at: new Date().toISOString() }).eq("id", id);
  }

  return (
    <AppShell
      role={`${t("role_guardian")} · ${data.profile.display_name}`}
      right={
        <span className={cn("chip", intel.connected ? "text-safe-300" : "text-warn-300")}>
          {intel.connected ? <RadioTower className="size-3.5" /> : <WifiOff className="size-3.5" />}
          <span className="hidden sm:inline">{intel.connected ? "ao vivo" : "reconectando"}</span>
        </span>
      }
    >
      {toast ? (
        <div role="status" className={cn("animate-rise fixed right-4 top-24 z-40 flex items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl", "panel-strong", levelClass(toast.level))} data-testid="guardian-toast">
          <BellRing className="size-5" style={{ color: "var(--lv)" }} />
          <div>
            <div className="text-sm font-semibold">Novo alerta: {levelLabel(toast.level)}</div>
            <div className="text-xs text-ink-300">{toast.title}</div>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <div className="flex flex-col gap-4">
          {/* estado atual */}
          <section className={cn("panel-strong p-5", levelClass(level))} aria-labelledby="estado" data-testid="guardian-state" data-level={level}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle id="estado">{t("current_state")}</CardTitle>
                <div className="mt-2 flex items-center gap-3">
                  <LevelBadge level={level} size="lg" />
                  <span className="text-sm text-ink-300">
                    {ward?.display_name ?? "Criança"} jogando com {other?.display_name ?? "outro participante"}
                  </span>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => setExplainOpen(true)}>
                {t("explain")}
              </Button>
            </div>
            <p className="mt-4 text-base leading-relaxed text-ink-50" data-testid="guardian-summary">
              {intel.latest?.guardian_summary ?? "Ainda não há análise. Assim que a conversa começar, você verá aqui um resumo em linguagem simples."}
            </p>
            <div className="mt-4 flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
              <RecoIcon className="mt-0.5 size-5 shrink-0" style={{ color: "var(--lv)" }} />
              <div>
                <div className="text-sm font-semibold">Recomendação: {recommendationLabel(reco)}</div>
                <div className="text-sm text-ink-300">{recommendationDetail(reco)}</div>
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-400">{t("not_proof")} Nenhuma punição é aplicada automaticamente.</p>
          </section>

          <SafetyPulse assessments={intel.assessments} latest={intel.latest} kase={intel.activeCase} onExplain={() => setExplainOpen(true)} />
        </div>

        <div className="flex flex-col gap-4">
          {/* alertas */}
          <Card>
            <CardTitle className="flex items-center gap-2">
              <Bell className="size-4" /> Alertas
            </CardTitle>
            {intel.alerts.length === 0 ? (
              <p className="mt-2 text-sm text-ink-400">Nenhum alerta. Você será avisado aqui, em tempo real.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2" data-testid="alert-list">
                {intel.alerts.map((a) => (
                  <li key={a.id} className={cn("rounded-xl border border-white/10 p-3", levelClass(a.level))}>
                    <div className="flex items-center justify-between gap-2">
                      <LevelBadge level={a.level} size="sm" />
                      <time className="text-[11px] text-ink-400" dateTime={a.created_at}>
                        {formatShortTime(a.created_at)}
                      </time>
                    </div>
                    <div className="mt-1.5 text-sm font-semibold">{a.title}</div>
                    <p className="text-xs text-ink-300">{a.summary}</p>
                    {!a.acknowledged_at ? (
                      <button type="button" onClick={() => void acknowledge(a.id)} className="focus-ring mt-2 text-xs font-semibold text-sky-400 underline">
                        Marcar como visto
                      </button>
                    ) : (
                      <div className="mt-2 text-[11px] text-ink-400">visto às {formatShortTime(a.acknowledged_at)}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* sinais e evidências mínimas */}
          <Card>
            <CardTitle>Sinais confirmados e mensagens relacionadas</CardTitle>
            {signalsForGuardian.length === 0 ? (
              <p className="mt-2 text-sm text-ink-400">Nada a destacar por enquanto.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {signalsForGuardian.map((c) => (
                  <li key={c.signal} className="rounded-xl border border-white/10 p-3">
                    <div className="text-sm font-semibold">{signalLabel(c.signal)}</div>
                    <div className="text-xs text-ink-300">{signalPlain(c.signal)}</div>
                  </li>
                ))}
              </ul>
            )}
            {evidence.length > 0 ? (
              <details className="mt-3 group">
                <summary className="focus-ring cursor-pointer text-xs font-semibold text-sky-400">Ver {evidence.length} mensagem(ns) relacionada(s) (exposição mínima)</summary>
                <ul className="mt-2 flex flex-col gap-1.5" data-testid="evidence-list">
                  {evidence.map((m) => {
                    const sender = intel.profiles.find((p) => p.id === m.sender_profile_id);
                    return (
                      <li key={m.id} className="rounded-lg bg-white/5 px-3 py-2 text-xs">
                        <span className="font-semibold text-sky-400">{sender?.display_name ?? "?"}: </span>
                        <span className="text-ink-100">{m.content}</span>
                      </li>
                    );
                  })}
                </ul>
                <p className="mt-1 text-[11px] text-ink-400">Você vê apenas as mensagens usadas como evidência, não a conversa inteira.</p>
              </details>
            ) : null}
          </Card>

          {/* revisão humana */}
          <Card>
            <CardTitle>Revisão humana</CardTitle>
            {!intel.activeCase ? (
              <p className="mt-2 text-sm text-ink-400">Nenhum caso em revisão.</p>
            ) : (
              <div className="mt-2 text-sm" data-testid="guardian-case">
                <div className="flex items-center justify-between">
                  <Badge>{CASE_STATUS_LABEL[intel.activeCase.status]}</Badge>
                  <span className="text-xs text-ink-400">prioridade {intel.activeCase.priority}</span>
                </div>
                {humanActions.length > 0 ? (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {humanActions.map((ac) => (
                      <li key={ac.id} className="rounded-lg border border-white/10 p-2 text-xs">
                        <div className="font-semibold">{ACTION_LABEL[ac.action] ?? ac.action}</div>
                        <div className="text-ink-300">{ac.justification}</div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs text-ink-400">Uma pessoa da moderação está revisando. A decisão e a justificativa aparecerão aqui.</p>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>

      <TransparencyDrawer
        open={explainOpen}
        onOpenChange={setExplainOpen}
        data={{ assessment: intel.latest, job: intel.jobs.find((j) => j.id === intel.latest?.job_id) ?? null, audit: intel.audit, kase: intel.activeCase, actions: humanActions }}
      />
    </AppShell>
  );
}
