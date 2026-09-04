export const SIGNAL_KEYS = [
  "vinculo_progressivo",
  "insistencia",
  "teste_limites",
  "pedido_segredo",
  "isolamento",
  "informacao_pessoal",
  "migracao_canal",
  "recompensa_promessa",
  "coercao",
  "linguagem_codificada",
  "conteudo_inadequado",
] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export const LEVELS = ["baixo", "atencao", "alto", "critico"] as const;
export type Level = (typeof LEVELS)[number];

export const TRENDS = ["subindo", "estavel", "caindo"] as const;
export type Trend = (typeof TRENDS)[number];

export const RECOMMENDATIONS = ["observar", "conversar", "revisar", "acionar_suporte_humano"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

export type SignalSource = "rule" | "llm" | "both";

/** Mensagem mínima que o motor precisa. Nunca inclui dados do remetente além do id. */
export interface WindowMessage {
  id: string;
  senderId: string;
  content: string;
  createdAt: string; // ISO
  seq: number;
}

export interface SignalHit {
  signal: SignalKey;
  messageId: string;
  senderId: string;
  at: string;
  /** rótulo curto do padrão (nunca a mensagem inteira) */
  pattern: string;
  confidence: number; // 0..1
  source: SignalSource;
}

export interface SignalContribution {
  signal: SignalKey;
  occurrences: number;
  baseWeight: number;
  contribution: number;
  evidenceMessageIds: string[];
  source: SignalSource;
  confidence: number;
}

export interface SequenceMatch {
  chain: string;
  matched: SignalKey[];
  bonus: number;
}

export interface RuleScore {
  score: number;
  rawSum: number;
  contributions: SignalContribution[];
  combinationBonus: number;
  sequenceBonus: number;
  sequences: SequenceMatch[];
  capApplied: string | null;
  distinctSignals: SignalKey[];
  hits: SignalHit[];
}

export interface ScoringConfig {
  halfLifeMinutes: number;
  recurrenceMultipliers: number[];
  perSignalCap: number; // multiplicador do peso base
  combinationBonus: Record<number, number>;
  singleIsolatedCap: number;
  singleRecurringCap: number;
  thresholds: { atencao: number; alto: number; critico: number };
  trendDelta: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  halfLifeMinutes: 30,
  recurrenceMultipliers: [1, 0.6, 0.4, 0.3, 0.2],
  perSignalCap: 1.8,
  combinationBonus: { 2: 4, 3: 8, 4: 12, 5: 16 },
  singleIsolatedCap: 30,
  singleRecurringCap: 45,
  thresholds: { atencao: 25, alto: 50, critico: 75 },
  trendDelta: 5,
};

export interface LlmTriggerInput {
  ruleScore: number;
  distinctSignalsInWindow: number;
  newMessagesSinceLastLlm: number;
  moderatorRequested: boolean;
  scenarioForced: boolean;
  config: { attentionThreshold: number; minNewMessages: number };
}

export interface BudgetInput {
  dailySpentUsd: number;
  dailyBudgetUsd: number;
  roomCalls: number;
  roomCallLimit: number;
  secondsSinceLastCall: number | null;
  cooldownSeconds: number;
  breakerOpenUntil: string | null;
  now: string;
  llmDisabledBySetting: boolean;
  hasApiKey: boolean;
}

export interface BudgetDecision {
  allowed: boolean;
  reason: string | null;
}
