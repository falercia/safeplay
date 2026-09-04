"use client";

import * as React from "react";
import { Activity, Bot, HelpCircle, Layers, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, LevelBadge } from "@/components/ui/badge";
import { CardTitle } from "@/components/ui/card";
import type { AssessmentRow, CaseRow, Level } from "@/lib/types";
import { CASE_STATUS_LABEL, formatShortTime, levelClass, signalLabel, trendLabel } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const LEVEL_COLOR: Record<Level, string> = {
  baixo: "#17c3b2",
  atencao: "#f2801e",
  alto: "#f79b4b",
  critico: "#e5484d",
};

export function SafetyPulse({
  assessments,
  latest,
  kase,
  onExplain,
  compact = false,
}: {
  assessments: AssessmentRow[];
  latest: AssessmentRow | null;
  kase: CaseRow | null;
  onExplain?: () => void;
  compact?: boolean;
}) {
  const { t } = useT();
  const level: Level = latest?.level ?? "baixo";
  const score = latest?.score ?? 0;
  const contributions = (latest?.details?.contributions ?? []).filter((c) => c.contribution > 0 || c.source === "llm");
  const agents = latest?.details?.agentsInvoked ?? ["MonitoringAgent"];
  const isolated = latest?.details?.isolatedVsPattern ?? { lastMessageScore: 0, accumulatedScore: score };

  return (
    <section className={cn("panel-strong relative overflow-hidden p-4 sm:p-6", levelClass(level))} aria-labelledby="pulse-title" data-testid="safety-pulse" data-level={level} data-score={score}>
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full opacity-30 blur-3xl" style={{ background: "var(--lv)" }} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <CardTitle id="pulse-title" className="flex items-center gap-2">
            <Activity className="size-4" /> {t("safety_pulse")}
          </CardTitle>
          <p className="mt-1 text-xs text-ink-400">{latest ? `atualizado ${formatShortTime(latest.created_at)} · ${latest.method}${latest.degraded ? " · modo degradado" : ""}` : "aguardando a primeira análise"}</p>
        </div>
        {onExplain ? (
          <Button variant="outline" size="sm" onClick={onExplain} data-testid="explain-button">
            <HelpCircle /> {t("explain")}
          </Button>
        ) : null}
      </div>

      <div className={cn("mt-4 grid gap-5", compact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-[auto_1fr]")}>
        {/* score */}
        <div className="flex items-center gap-5">
          <ScoreRing score={score} level={level} />
          <div className="flex flex-col gap-2">
            <LevelBadge level={level} size="lg" />
            <div className="text-sm text-ink-200">
              tendência <span className="font-semibold text-ink-50">{trendLabel[latest?.trend ?? "estavel"]}</span>
            </div>
            <div className="text-xs text-ink-400">
              regras {latest?.rule_score ?? 0}
              {latest?.llm_score !== null && latest?.llm_score !== undefined ? ` · LLM ${latest.llm_score}` : " · LLM não acionada"}
              {latest?.divergence ? <span className="ml-1 text-warn-300">· divergência</span> : null}
            </div>
          </div>
        </div>

        {/* curva */}
        <div className="min-w-0">
          <Sparkline points={assessments.map((a) => ({ t: new Date(a.created_at).getTime(), score: a.score, level: a.level }))} />
        </div>
      </div>

      {/* isolado vs acumulado */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Bar label="Última mensagem isolada" value={isolated.lastMessageScore} hint="o que um filtro de frase única veria" />
        <Bar label="Padrão acumulado" value={isolated.accumulatedScore} hint="combinação, ordem, recorrência e tempo" strong />
      </div>

      {/* sinais */}
      <div className="mt-5">
        <CardTitle className="mb-2">Sinais no padrão</CardTitle>
        {contributions.length === 0 ? (
          <p className="text-sm text-ink-400">Nenhum sinal de risco identificado até agora.</p>
        ) : (
          <div className="flex flex-wrap gap-2" data-testid="signal-chips">
            {contributions.map((c) => (
              <Badge key={c.signal} className={cn(c.contribution > 0 ? "level-badge" : "", levelClass(level))} title={`${c.occurrences}x · contribuição ${c.contribution} · fonte ${c.source}`}>
                {signalLabel(c.signal)}
                <span className="opacity-70">×{c.occurrences}</span>
                {c.source !== "rule" ? <Bot className="size-3 opacity-70" aria-label="fonte LLM" /> : null}
              </Badge>
            ))}
            {(latest?.details?.sequenceBonus ?? 0) > 0 ? (
              <Badge className="border-warn-500/40 text-warn-300">
                <Layers className="size-3" /> sequência coerente +{latest?.details?.sequenceBonus}
              </Badge>
            ) : null}
          </div>
        )}
      </div>

      {/* agentes e revisão humana */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div>
          <CardTitle className="mb-2">Módulos acionados</CardTitle>
          <div className="flex flex-wrap gap-2">
            {(["MonitoringAgent", "CodedLanguageAgent", "ParentalProtectionAgent", "EscalationAgent"] as const).map((a) => (
              <Badge key={a} className={cn(agents.includes(a) ? "border-safe-500/40 text-safe-300" : "opacity-40")}>
                {a}
              </Badge>
            ))}
          </div>
        </div>
        <div>
          <CardTitle className="mb-2 flex items-center gap-2">
            <UserCheck className="size-4" /> Revisão humana
          </CardTitle>
          {kase ? (
            <div className="text-sm" data-testid="review-state">
              <span className={cn("font-semibold", kase.status === "dismissed" ? "text-safe-300" : kase.status === "confirmed" || kase.status === "contained" ? "text-warn-300" : "text-sky-400")}>{CASE_STATUS_LABEL[kase.status]}</span>
              <span className="text-ink-400"> · prioridade {kase.priority}</span>
            </div>
          ) : (
            <p className="text-sm text-ink-400">Nenhum caso aberto. Decisões críticas exigem uma pessoa.</p>
          )}
        </div>
      </div>
    </section>
  );
}

function ScoreRing({ score, level }: { score: number; level: Level }) {
  const r = 44;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  return (
    <div className="relative size-28 shrink-0" role="img" aria-label={`Score de risco ${score} de 100`}>
      <svg viewBox="0 0 110 110" className="size-full -rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(163,179,204,0.15)" strokeWidth="9" />
        <circle cx="55" cy="55" r={r} fill="none" stroke={LEVEL_COLOR[level]} strokeWidth="9" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: "stroke-dashoffset 600ms ease, stroke 300ms ease" }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl font-bold leading-none" data-testid="score-value">
          {score}
        </span>
        <span className="text-[10px] uppercase tracking-wider text-ink-400">/100</span>
      </div>
    </div>
  );
}

function Sparkline({ points }: { points: { t: number; score: number; level: Level }[] }) {
  const w = 420;
  const h = 120;
  const pad = 8;
  if (points.length === 0) {
    return <div className="flex h-[120px] items-center justify-center rounded-xl border border-dashed border-white/10 text-xs text-ink-400">A curva de evolução aparece a partir da primeira análise.</div>;
  }
  const xs = points.map((_, i) => (points.length === 1 ? w / 2 : pad + (i / (points.length - 1)) * (w - 2 * pad)));
  const y = (s: number) => h - pad - (s / 100) * (h - 2 * pad);
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${xs[i]},${y(p.score)}`).join(" ");
  const bands: { from: number; to: number; color: string }[] = [
    { from: 0, to: 25, color: "rgba(23,195,178,0.08)" },
    { from: 25, to: 50, color: "rgba(242,128,30,0.08)" },
    { from: 50, to: 75, color: "rgba(247,155,75,0.12)" },
    { from: 75, to: 100, color: "rgba(229,72,77,0.14)" },
  ];
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-[120px] w-full" role="img" aria-label="Evolução do score de risco ao longo da conversa">
      {bands.map((b) => (
        <rect key={b.from} x={0} y={y(b.to)} width={w} height={y(b.from) - y(b.to)} fill={b.color} />
      ))}
      {[25, 50, 75].map((v) => (
        <line key={v} x1={0} x2={w} y1={y(v)} y2={y(v)} stroke="rgba(163,179,204,0.18)" strokeDasharray="3 4" />
      ))}
      <path d={path} fill="none" stroke={LEVEL_COLOR[last.level]} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
      {points.map((p, i) => (
        <circle key={i} cx={xs[i]} cy={y(p.score)} r={i === points.length - 1 ? 5 : 3} fill={LEVEL_COLOR[p.level]} />
      ))}
      <text x={w - pad} y={y(last.score) - 8} textAnchor="end" fontSize="11" fill="#e6ecf5" fontWeight="700">
        {last.score}
      </text>
    </svg>
  );
}

function Bar({ label, value, hint, strong }: { label: string; value: number; hint: string; strong?: boolean }) {
  const lv: Level = value >= 75 ? "critico" : value >= 50 ? "alto" : value >= 25 ? "atencao" : "baixo";
  return (
    <div className={cn("rounded-xl border border-white/10 p-3", strong && "bg-white/5")}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="font-semibold text-ink-100">{label}</span>
        <span className="font-display text-base font-bold" style={{ color: LEVEL_COLOR[lv] }}>
          {value}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${value}%`, background: LEVEL_COLOR[lv] }} />
      </div>
      <div className="mt-1 text-[11px] text-ink-400">{hint}</div>
    </div>
  );
}
