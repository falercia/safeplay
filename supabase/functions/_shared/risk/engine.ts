import { DEFAULT_SCORING, type Level, type ScoringConfig, type SignalHit, type WindowMessage } from "./types.ts";
import type { Assessment, LlmOutput } from "./contract.ts";
import { detectMessageSignals, detectWindowSignals } from "./rules.ts";
import { scoreHits } from "./scoring.ts";
import { escalate, levelFromScore, llmTriggerReasons, mergeScores, recommendationForLevel, trendFromScores, type EscalationDecision } from "./policy.ts";
import { buildGuardianSummary } from "./guardian.ts";
import { detectCandidateTerms, SYNTHETIC_GLOSSARY, type GlossaryTerm } from "./glossary.ts";
import { GLOSSARY_VERSION, RULES_VERSION } from "./version.ts";

export interface EvaluateInput {
  /** mensagens da sala (até o limite longitudinal), ordenadas por seq asc */
  messages: WindowMessage[];
  nowIso: string;
  previousScore: number | null;
  previousLevel: Level | null;
  glossary?: GlossaryTerm[];
  config?: ScoringConfig;
  /** tamanho da janela recente enviada à LLM e exibida ao moderador */
  windowSize?: number;
  llm?: LlmOutput | null;
  degradedReason?: string | null;
  llmTriggerReasons?: string[];
  hasOpenCase?: boolean;
}

export interface EvaluateOutput {
  assessment: Assessment;
  escalation: EscalationDecision;
  /** hits determinísticos (para persistência de sinais) */
  hits: SignalHit[];
  /** ids da janela recente (LLM/moderador) */
  windowMessageIds: string[];
}

/**
 * Orquestrador puro dos quatro módulos:
 * MonitoringAgent (janela + progressão) → CodedLanguageAgent (glossário/candidatos)
 * → ParentalProtectionAgent (resumo/recomendação) → EscalationAgent (política).
 * Sem I/O. A chamada à LLM acontece fora e entra aqui como `llm` já validada.
 */
export function evaluate(input: EvaluateInput): EvaluateOutput {
  const config = input.config ?? DEFAULT_SCORING;
  const glossary = input.glossary ?? SYNTHETIC_GLOSSARY;
  const windowSize = input.windowSize ?? 12;
  const messages = [...input.messages].sort((a, b) => a.seq - b.seq);
  const window = messages.slice(-windowSize);
  const windowMessageIds = window.map((m) => m.id);

  // MonitoringAgent + CodedLanguageAgent (regras + glossário aprovado)
  const ruleHits = detectWindowSignals(messages, { glossary });
  const ruleScore = scoreHits(ruleHits, input.nowIso, config);

  // mensagem isolada vs padrão acumulado
  const last = messages[messages.length - 1];
  const lastHits = last ? detectMessageSignals(last, { glossary }) : [];
  const lastScore = last ? scoreHits(lastHits, input.nowIso, config).score : 0;

  // candidatos de código (heurística), sujeitos a revisão humana
  const heuristicCandidates = new Set<string>();
  for (const m of window) for (const t of detectCandidateTerms(m.content, glossary)) heuristicCandidates.add(t);

  // integração da LLM (opcional)
  const llm = input.llm ?? null;
  const llmHits: SignalHit[] = [];
  if (llm) {
    const validIds = new Set(windowMessageIds);
    for (const s of llm.signals) {
      const ids = s.message_ids.filter((id) => validIds.has(id));
      for (const id of ids) {
        const m = window.find((w) => w.id === id);
        if (!m) continue;
        llmHits.push({ signal: s.key, messageId: id, senderId: m.senderId, at: m.createdAt, pattern: s.note ?? "sinal apontado pela LLM", confidence: s.confidence, source: "llm" });
      }
    }
  }

  const merged = mergeScores({ ruleScore: ruleScore.score, llmScore: llm ? Math.round(llm.risk_score) : null, llmConfidence: llm?.confidence ?? null });

  // contribuições finais: regras + sinais só-LLM (contribuição 0 no score, mas evidenciados)
  const contributions = [...ruleScore.contributions];
  const known = new Set(contributions.map((c) => c.signal));
  for (const h of llmHits) {
    const existing = contributions.find((c) => c.signal === h.signal);
    if (existing) {
      if (!existing.evidenceMessageIds.includes(h.messageId)) existing.evidenceMessageIds.push(h.messageId);
      existing.source = "both";
      continue;
    }
    if (known.has(h.signal)) continue;
    known.add(h.signal);
    contributions.push({ signal: h.signal, occurrences: 1, baseWeight: 0, contribution: 0, evidenceMessageIds: [h.messageId], source: "llm", confidence: h.confidence });
  }

  const level = levelFromScore(merged.finalScore, config);
  const trend = trendFromScores(merged.finalScore, input.previousScore, config);
  const recommendation = llm?.recommendation && level !== "baixo" ? strongest(recommendationForLevel(level), llm.recommendation) : recommendationForLevel(level);
  const ruleSummary = buildGuardianSummary(level, trend, contributions);
  const guardianSummary = llm && level !== "baixo" ? llm.guardian_summary : ruleSummary;

  const degraded = !llm && (input.degradedReason ?? null) !== null;
  const escalation = escalate({
    level,
    previousLevel: input.previousLevel,
    distinctSignals: contributions.filter((c) => c.contribution > 0).length,
    divergence: merged.divergence,
    degraded,
    hasOpenCase: input.hasOpenCase ?? false,
  });

  const agents: Assessment["agentsInvoked"] = ["MonitoringAgent"];
  if (ruleHits.some((h) => h.signal === "linguagem_codificada") || heuristicCandidates.size > 0 || (llm?.candidate_terms.length ?? 0) > 0) agents.push("CodedLanguageAgent");
  if (level !== "baixo") agents.push("ParentalProtectionAgent");
  if (escalation.alert.send || escalation.caseRequest.open) agents.push("EscalationAgent");

  const assessment: Assessment = {
    score: merged.finalScore,
    ruleScore: ruleScore.score,
    llmScore: llm ? Math.round(llm.risk_score) : null,
    llmConfidence: llm ? llm.confidence : null,
    level,
    trend,
    recommendation,
    guardianSummary,
    divergence: merged.divergence,
    divergenceDelta: merged.divergenceDelta,
    degraded,
    degradedReason: degraded ? (input.degradedReason ?? null) : null,
    method: merged.method,
    contributions,
    combinationBonus: ruleScore.combinationBonus,
    sequenceBonus: ruleScore.sequenceBonus,
    sequences: ruleScore.sequences,
    capApplied: ruleScore.capApplied,
    windowMessageIds,
    agentsInvoked: agents,
    llmTriggerReasons: input.llmTriggerReasons ?? [],
    candidateTerms: [
      ...[...heuristicCandidates].map((term) => ({ term, reason: "token marcado junto de pedido de sigilo", source: "heuristica" as const })),
      ...(llm?.candidate_terms ?? []).map((c) => ({ term: c.term, reason: c.reason, source: "llm" as const })),
    ],
    isolatedVsPattern: { lastMessageScore: lastScore, accumulatedScore: merged.finalScore },
    rulesVersion: RULES_VERSION,
    glossaryVersion: GLOSSARY_VERSION,
  };

  return { assessment, escalation, hits: [...ruleHits, ...llmHits], windowMessageIds };
}

const RECO_ORDER = { observar: 0, conversar: 1, revisar: 2, acionar_suporte_humano: 3 } as const;
function strongest<T extends keyof typeof RECO_ORDER>(a: T, b: T): T {
  return RECO_ORDER[a] >= RECO_ORDER[b] ? a : b;
}

/** Decide se a LLM deve ser chamada, com base no estado atual. */
export function shouldCallLlm(params: {
  ruleScore: number;
  distinctSignalsInWindow: number;
  newMessagesSinceLastLlm: number;
  moderatorRequested: boolean;
  scenarioForced: boolean;
  attentionThreshold?: number;
  minNewMessages?: number;
}): string[] {
  return llmTriggerReasons({
    ruleScore: params.ruleScore,
    distinctSignalsInWindow: params.distinctSignalsInWindow,
    newMessagesSinceLastLlm: params.newMessagesSinceLastLlm,
    moderatorRequested: params.moderatorRequested,
    scenarioForced: params.scenarioForced,
    config: { attentionThreshold: params.attentionThreshold ?? DEFAULT_SCORING.thresholds.atencao, minNewMessages: params.minNewMessages ?? 3 },
  });
}
