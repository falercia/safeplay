import { DEFAULT_SCORING, type RuleScore, type ScoringConfig, type SequenceMatch, type SignalContribution, type SignalHit, type SignalKey } from "./types.ts";
import { SIGNAL_DEFINITIONS } from "./taxonomy.ts";

/** Cadeias coerentes de progressão. A ordem importa: bônus só com ordem preservada. */
export const SEQUENCE_CHAINS: { name: string; chain: SignalKey[] }[] = [
  { name: "aproximacao_e_saida", chain: ["vinculo_progressivo", "informacao_pessoal", "pedido_segredo", "migracao_canal"] },
  { name: "recompensa_e_pressao", chain: ["recompensa_promessa", "pedido_segredo", "coercao"] },
  { name: "isolamento_e_sondagem", chain: ["vinculo_progressivo", "isolamento", "teste_limites"] },
  { name: "codigo_e_segredo", chain: ["linguagem_codificada", "pedido_segredo", "migracao_canal"] },
];

function decayFactor(ageMinutes: number, halfLife: number): number {
  if (halfLife <= 0) return 1;
  return Math.pow(0.5, Math.max(0, ageMinutes) / halfLife);
}

/**
 * Score longitudinal: combinação, ordem, recorrência e tempo.
 * - cada ocorrência decai com meia-vida configurável;
 * - recorrência do mesmo sinal tem retorno decrescente;
 * - combinações de sinais distintos ganham bônus;
 * - cadeias em ordem ganham bônus de sequência;
 * - uma ocorrência isolada é limitada a "atenção".
 */
export function scoreHits(hits: SignalHit[], nowIso: string, config: ScoringConfig = DEFAULT_SCORING): RuleScore {
  const now = new Date(nowIso).getTime();
  const bySignal = new Map<SignalKey, SignalHit[]>();
  for (const h of [...hits].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())) {
    const arr = bySignal.get(h.signal) ?? [];
    arr.push(h);
    bySignal.set(h.signal, arr);
  }

  const contributions: SignalContribution[] = [];
  for (const [signal, list] of bySignal) {
    const base = SIGNAL_DEFINITIONS[signal].weight;
    let acc = 0;
    // mais recente primeiro para que a recorrência penalize as antigas
    const recentFirst = [...list].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    recentFirst.forEach((h, i) => {
      const ageMin = (now - new Date(h.at).getTime()) / 60000;
      const rec = config.recurrenceMultipliers[Math.min(i, config.recurrenceMultipliers.length - 1)] ?? 0.2;
      acc += decayFactor(ageMin, config.halfLifeMinutes) * rec * h.confidence;
    });
    const contribution = Math.min(base * acc, base * config.perSignalCap);
    const sources = new Set(list.map((h) => h.source));
    contributions.push({
      signal,
      occurrences: list.length,
      baseWeight: base,
      contribution: round1(contribution),
      evidenceMessageIds: [...new Set(list.map((h) => h.messageId))],
      source: sources.size > 1 ? "both" : (list[0]?.source ?? "rule"),
      confidence: round2(Math.max(...list.map((h) => h.confidence))),
    });
  }
  contributions.sort((a, b) => b.contribution - a.contribution);

  const rawSum = contributions.reduce((s, c) => s + c.contribution, 0);
  const distinct = contributions.map((c) => c.signal);

  // bônus de combinação
  let combinationBonus = 0;
  for (const k of Object.keys(config.combinationBonus).map(Number).sort((a, b) => a - b)) {
    if (distinct.length >= k) combinationBonus = config.combinationBonus[k] ?? combinationBonus;
  }

  // bônus de sequência (ordem pela primeira ocorrência de cada sinal)
  const firstAt = new Map<SignalKey, number>();
  for (const [signal, list] of bySignal) firstAt.set(signal, Math.min(...list.map((h) => new Date(h.at).getTime())));
  const sequences: SequenceMatch[] = [];
  for (const { name, chain } of SEQUENCE_CHAINS) {
    const present = chain.filter((s) => firstAt.has(s));
    if (present.length < 3) continue;
    const times = present.map((s) => firstAt.get(s) ?? 0);
    const ordered = times.every((t, i) => i === 0 || t >= (times[i - 1] ?? 0));
    if (!ordered) continue;
    const bonus = present.length === chain.length ? 25 : 15;
    sequences.push({ chain: name, matched: present, bonus });
  }
  const sequenceBonus = sequences.reduce((m, s) => Math.max(m, s.bonus), 0);

  let score = rawSum + combinationBonus + sequenceBonus;
  let capApplied: string | null = null;
  const totalOccurrences = hits.length;
  if (distinct.length === 1 && totalOccurrences === 1) {
    if (score > config.singleIsolatedCap) capApplied = "ocorrencia_isolada";
    score = Math.min(score, config.singleIsolatedCap);
  } else if (distinct.length === 1) {
    if (score > config.singleRecurringCap) capApplied = "sinal_unico_recorrente";
    score = Math.min(score, config.singleRecurringCap);
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  return { score, rawSum: round1(rawSum), contributions, combinationBonus, sequenceBonus, sequences, capApplied, distinctSignals: distinct, hits };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
