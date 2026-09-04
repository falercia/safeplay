import { z } from "zod";
import { LEVELS, RECOMMENDATIONS, SIGNAL_KEYS, TRENDS } from "./types.ts";

/** Saída estruturada esperada da LLM. Uma única chamada, validada com Zod. */
export const LlmOutputSchema = z.object({
  risk_score: z.number().min(0).max(100),
  confidence: z.number().min(0).max(1),
  signals: z
    .array(
      z.object({
        key: z.enum(SIGNAL_KEYS),
        message_ids: z.array(z.string().min(1)).max(12),
        confidence: z.number().min(0).max(1),
        note: z.string().max(160).optional(),
      }),
    )
    .max(11),
  guardian_summary: z.string().min(10).max(420),
  recommendation: z.enum(RECOMMENDATIONS),
  candidate_terms: z
    .array(z.object({ term: z.string().min(2).max(40), reason: z.string().max(160) }))
    .max(5)
    .default([]),
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;

export const SignalContributionSchema = z.object({
  signal: z.enum(SIGNAL_KEYS),
  occurrences: z.number().int().min(0),
  baseWeight: z.number(),
  contribution: z.number(),
  evidenceMessageIds: z.array(z.string()),
  source: z.enum(["rule", "llm", "both"]),
  confidence: z.number().min(0).max(1),
});

/** Contrato da avaliação persistida (o que a UI consome). */
export const AssessmentSchema = z.object({
  score: z.number().int().min(0).max(100),
  ruleScore: z.number().int().min(0).max(100),
  llmScore: z.number().int().min(0).max(100).nullable(),
  llmConfidence: z.number().min(0).max(1).nullable(),
  level: z.enum(LEVELS),
  trend: z.enum(TRENDS),
  recommendation: z.enum(RECOMMENDATIONS),
  guardianSummary: z.string(),
  divergence: z.boolean(),
  divergenceDelta: z.number().nullable(),
  degraded: z.boolean(),
  degradedReason: z.string().nullable(),
  method: z.enum(["regras", "regras+llm"]),
  contributions: z.array(SignalContributionSchema),
  combinationBonus: z.number(),
  sequenceBonus: z.number(),
  sequences: z.array(z.object({ chain: z.string(), matched: z.array(z.enum(SIGNAL_KEYS)), bonus: z.number() })),
  capApplied: z.string().nullable(),
  windowMessageIds: z.array(z.string()),
  agentsInvoked: z.array(z.enum(["MonitoringAgent", "CodedLanguageAgent", "ParentalProtectionAgent", "EscalationAgent"])),
  llmTriggerReasons: z.array(z.string()),
  candidateTerms: z.array(z.object({ term: z.string(), reason: z.string(), source: z.enum(["heuristica", "llm"]) })),
  isolatedVsPattern: z.object({
    lastMessageScore: z.number().int().min(0).max(100),
    accumulatedScore: z.number().int().min(0).max(100),
  }),
  rulesVersion: z.string(),
  glossaryVersion: z.number().int(),
});
export type Assessment = z.infer<typeof AssessmentSchema>;

/** Tenta extrair JSON de uma resposta textual (a LLM pode envolver em ```json). */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced?.[1] ?? trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("no_json_object");
  return JSON.parse(candidate.slice(start, end + 1));
}
