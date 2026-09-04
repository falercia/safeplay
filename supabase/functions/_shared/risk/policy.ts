import { DEFAULT_SCORING, type BudgetDecision, type BudgetInput, type Level, type LlmTriggerInput, type Recommendation, type ScoringConfig, type Trend } from "./types.ts";

export function levelFromScore(score: number, config: ScoringConfig = DEFAULT_SCORING): Level {
  if (score >= config.thresholds.critico) return "critico";
  if (score >= config.thresholds.alto) return "alto";
  if (score >= config.thresholds.atencao) return "atencao";
  return "baixo";
}

export function trendFromScores(current: number, previous: number | null, config: ScoringConfig = DEFAULT_SCORING): Trend {
  if (previous === null) return current >= config.thresholds.atencao ? "subindo" : "estavel";
  if (current - previous >= config.trendDelta) return "subindo";
  if (previous - current >= config.trendDelta) return "caindo";
  return "estavel";
}

export function recommendationForLevel(level: Level): Recommendation {
  switch (level) {
    case "baixo":
      return "observar";
    case "atencao":
      return "conversar";
    case "alto":
      return "revisar";
    case "critico":
      return "acionar_suporte_humano";
  }
}

export const LEVEL_ORDER: Record<Level, number> = { baixo: 0, atencao: 1, alto: 2, critico: 3 };

/** Condições para chamar a LLM. Retorna as razões; vazio = não chamar. */
export function llmTriggerReasons(input: LlmTriggerInput): string[] {
  const reasons: string[] = [];
  if (input.ruleScore >= input.config.attentionThreshold) reasons.push("regra_acima_do_limiar_de_atencao");
  if (input.distinctSignalsInWindow >= 2) reasons.push("dois_ou_mais_sinais_na_janela");
  if (input.newMessagesSinceLastLlm >= input.config.minNewMessages && input.distinctSignalsInWindow >= 1) reasons.push("novas_mensagens_desde_ultima_analise");
  if (input.moderatorRequested) reasons.push("reanalise_solicitada_pelo_moderador");
  if (input.scenarioForced) reasons.push("cenario_da_demo_solicitou_analise_real");
  return reasons;
}

/** Guarda de orçamento, cooldown e circuit breaker. Pura. */
export function budgetGuard(input: BudgetInput): BudgetDecision {
  if (!input.hasApiKey) return { allowed: false, reason: "sem_chave_de_api" };
  if (input.llmDisabledBySetting) return { allowed: false, reason: "llm_desativada_pelo_apresentador" };
  if (input.breakerOpenUntil && new Date(input.breakerOpenUntil).getTime() > new Date(input.now).getTime()) {
    return { allowed: false, reason: "circuit_breaker_aberto" };
  }
  if (input.dailySpentUsd >= input.dailyBudgetUsd) return { allowed: false, reason: "orcamento_diario_esgotado" };
  if (input.roomCalls >= input.roomCallLimit) return { allowed: false, reason: "limite_de_chamadas_da_sala" };
  if (input.secondsSinceLastCall !== null && input.secondsSinceLastCall < input.cooldownSeconds) {
    return { allowed: false, reason: "cooldown_ativo" };
  }
  return { allowed: true, reason: null };
}

export interface MergeInput {
  ruleScore: number;
  llmScore: number | null;
  llmConfidence: number | null;
}

export interface MergeResult {
  finalScore: number;
  divergence: boolean;
  divergenceDelta: number | null;
  method: "regras" | "regras+llm";
}

/**
 * Combinação determinística. Postura do deck: errar para o alerta.
 * A LLM pode elevar a hipótese, mas nunca reduz o score das regras abaixo do próprio valor,
 * porque a regra é auditável e a LLM é apenas enriquecimento sujeito a revisão humana.
 */
export function mergeScores(input: MergeInput): MergeResult {
  if (input.llmScore === null) {
    return { finalScore: input.ruleScore, divergence: false, divergenceDelta: null, method: "regras" };
  }
  const confidence = input.llmConfidence ?? 0.5;
  const blended = Math.round(input.ruleScore * (1 - 0.5 * confidence) + input.llmScore * (0.5 * confidence));
  const finalScore = Math.max(input.ruleScore, Math.min(100, blended));
  const delta = input.llmScore - input.ruleScore;
  return { finalScore, divergence: Math.abs(delta) >= 25, divergenceDelta: delta, method: "regras+llm" };
}

export interface EscalationInput {
  level: Level;
  previousLevel: Level | null;
  distinctSignals: number;
  divergence: boolean;
  degraded: boolean;
  hasOpenCase: boolean;
}

export type CaseRequest = { open: boolean; priority: 1 | 2 | 3 | null; slaMinutes: number | null; reason: string | null };
export type AlertRequest = { send: boolean; reason: string | null };

export interface EscalationDecision {
  alert: AlertRequest;
  caseRequest: CaseRequest;
  recommendedAction: string;
}

/**
 * Política determinística do EscalationAgent.
 * - atenção: alerta informativo ao responsável; caso de baixa prioridade quando há 2+ sinais distintos
 *   ou quando regra e LLM divergem (verificação humana de possível falso positivo).
 * - alto: alerta + caso prioridade 2 (meta futura de SLA: 60 min).
 * - crítico: alerta + caso prioridade 1 (SLA de demonstração: 15 min) + sugestão de contenção temporária.
 * Nenhuma ação punitiva é automática.
 */
export function escalate(input: EscalationInput): EscalationDecision {
  const { level } = input;
  const escalatedFromLower = input.previousLevel === null || LEVEL_ORDER[level] > LEVEL_ORDER[input.previousLevel];

  if (level === "baixo") {
    return {
      alert: { send: false, reason: null },
      caseRequest: { open: false, priority: null, slaMinutes: null, reason: null },
      recommendedAction: "sem_acao",
    };
  }
  if (level === "atencao") {
    const needsHumanCheck = input.divergence || input.distinctSignals >= 2;
    return {
      alert: { send: escalatedFromLower, reason: escalatedFromLower ? "nivel_atencao_atingido" : null },
      caseRequest: needsHumanCheck
        ? { open: true, priority: 3, slaMinutes: 240, reason: input.divergence ? "divergencia_regra_llm" : "multiplos_sinais_em_nivel_atencao" }
        : { open: false, priority: null, slaMinutes: null, reason: null },
      recommendedAction: needsHumanCheck ? "verificacao_humana_de_falso_positivo" : "monitorar_e_informar_responsavel",
    };
  }
  if (level === "alto") {
    return {
      alert: { send: true, reason: "nivel_alto_atingido" },
      caseRequest: { open: true, priority: 2, slaMinutes: 60, reason: "nivel_alto" },
      recommendedAction: "revisao_humana_prioritaria",
    };
  }
  return {
    alert: { send: true, reason: "nivel_critico_atingido" },
    caseRequest: { open: true, priority: 1, slaMinutes: 15, reason: "nivel_critico" },
    recommendedAction: "revisao_humana_imediata_e_contencao_sugerida",
  };
}
