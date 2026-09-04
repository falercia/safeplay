import { describe, expect, it } from "vitest";
import {
  budgetGuard,
  detectMessageSignals,
  evaluate,
  escalate,
  extractJson,
  levelFromScore,
  LlmOutputSchema,
  matchGlossary,
  mergeScores,
  SCENARIOS,
  scoreHits,
  shouldCallLlm,
  trendFromScores,
  type Level,
  type WindowMessage,
} from "@risk/index.ts";

const BASE = Date.parse("2026-09-04T12:00:00.000Z");

function msg(i: number, senderId: string, content: string, offsetSec = i * 20): WindowMessage {
  return { id: `m${i}`, senderId, content, createdAt: new Date(BASE + offsetSec * 1000).toISOString(), seq: i };
}

function runScript(key: keyof typeof SCENARIOS) {
  const s = SCENARIOS[key];
  const msgs: WindowMessage[] = [];
  const timeline: { i: number; score: number; level: Level; caseOpen: boolean; alert: boolean }[] = [];
  let prevScore: number | null = null;
  let prevLevel: Level | null = null;
  s.script.forEach((line, i) => {
    msgs.push(msg(i + 1, line.speaker === "A" ? "persona-a" : "persona-b", line.text));
    const nowIso = new Date(BASE + (i + 1) * 20 * 1000 + 500).toISOString();
    const out = evaluate({ messages: msgs, nowIso, previousScore: prevScore, previousLevel: prevLevel });
    timeline.push({ i: i + 1, score: out.assessment.score, level: out.assessment.level, caseOpen: out.escalation.caseRequest.open, alert: out.escalation.alert.send });
    prevScore = out.assessment.score;
    prevLevel = out.assessment.level;
  });
  return timeline;
}

describe("regras por mensagem", () => {
  it("detecta pedido de segredo e migração de canal", () => {
    const hits = detectMessageSignals(msg(1, "b", "isso fica só entre a gente, vamos pro whats"));
    const keys = hits.map((h) => h.signal);
    expect(keys).toContain("pedido_segredo");
    expect(keys).toContain("migracao_canal");
  });
  it("não dispara em conversa cooperativa comum", () => {
    for (const line of SCENARIOS.saudavel.script) {
      expect(detectMessageSignals(msg(1, "x", line.text))).toHaveLength(0);
    }
  });
  it("glossário sintético mapeia termos aprovados", () => {
    expect(matchGlossary("vamos pro Portal ZP agora")).toEqual([{ term: "portal zp", signal: "migracao_canal", status: "approved" }]);
    expect(matchGlossary("nada aqui")).toEqual([]);
  });
});

describe("score longitudinal", () => {
  it("ocorrência isolada nunca ultrapassa o limite de atenção", () => {
    const hits = detectMessageSignals(msg(1, "b", "não conta pra ninguém"));
    const r = scoreHits(hits, new Date(BASE + 1000).toISOString());
    expect(r.score).toBeLessThanOrEqual(30);
    expect(levelFromScore(r.score)).not.toBe("alto");
  });
  it("combinação coerente produz bônus de sequência", () => {
    const msgs = [
      msg(1, "b", "só você me entende"),
      msg(2, "b", "onde você mora?"),
      msg(3, "b", "não conta pra ninguém"),
      msg(4, "b", "vamos pro telegram"),
    ];
    const hits = msgs.flatMap((m) => detectMessageSignals(m));
    const r = scoreHits(hits, new Date(BASE + 100 * 1000).toISOString());
    expect(r.sequences.some((s) => s.chain === "aproximacao_e_saida" && s.bonus === 25)).toBe(true);
    expect(r.score).toBeGreaterThanOrEqual(75);
  });
  it("ordem invertida não ganha bônus de sequência", () => {
    const msgs = [msg(1, "b", "vamos pro telegram"), msg(2, "b", "não conta pra ninguém"), msg(3, "b", "onde você mora?"), msg(4, "b", "só você me entende")];
    const hits = msgs.flatMap((m) => detectMessageSignals(m));
    const r = scoreHits(hits, new Date(BASE + 100 * 1000).toISOString());
    expect(r.sequences.find((s) => s.chain === "aproximacao_e_saida")).toBeUndefined();
  });
  it("decaimento temporal reduz contribuição de sinais antigos", () => {
    const hits = detectMessageSignals(msg(1, "b", "onde você mora?", 0));
    const fresh = scoreHits(hits, new Date(BASE + 1000).toISOString()).rawSum;
    const old = scoreHits(hits, new Date(BASE + 120 * 60 * 1000).toISOString()).rawSum;
    expect(old).toBeLessThan(fresh / 4);
  });
  it("recorrência tem retorno decrescente e cap por sinal", () => {
    const hits = [1, 2, 3, 4, 5, 6].flatMap((i) => detectMessageSignals(msg(i, "b", "responde logo", i)));
    const r = scoreHits(hits, new Date(BASE + 10 * 1000).toISOString());
    const c = r.contributions[0];
    expect(c?.occurrences).toBe(6);
    expect(c?.contribution).toBeLessThanOrEqual(6 * 1.8);
    expect(r.score).toBeLessThanOrEqual(45);
  });
});

describe("política", () => {
  it("níveis por faixa", () => {
    expect(levelFromScore(0)).toBe("baixo");
    expect(levelFromScore(25)).toBe("atencao");
    expect(levelFromScore(50)).toBe("alto");
    expect(levelFromScore(75)).toBe("critico");
  });
  it("tendência", () => {
    expect(trendFromScores(40, 20)).toBe("subindo");
    expect(trendFromScores(20, 40)).toBe("caindo");
    expect(trendFromScores(22, 20)).toBe("estavel");
  });
  it("gatilho de LLM exige condição explícita", () => {
    expect(shouldCallLlm({ ruleScore: 5, distinctSignalsInWindow: 0, newMessagesSinceLastLlm: 1, moderatorRequested: false, scenarioForced: false })).toEqual([]);
    expect(shouldCallLlm({ ruleScore: 30, distinctSignalsInWindow: 1, newMessagesSinceLastLlm: 0, moderatorRequested: false, scenarioForced: false })).toContain("regra_acima_do_limiar_de_atencao");
    expect(shouldCallLlm({ ruleScore: 5, distinctSignalsInWindow: 0, newMessagesSinceLastLlm: 0, moderatorRequested: true, scenarioForced: false })).toContain("reanalise_solicitada_pelo_moderador");
  });
  it("guarda de orçamento", () => {
    const base = { dailySpentUsd: 0, dailyBudgetUsd: 2, roomCalls: 0, roomCallLimit: 50, secondsSinceLastCall: null, cooldownSeconds: 15, breakerOpenUntil: null, now: new Date(BASE).toISOString(), llmDisabledBySetting: false, hasApiKey: true };
    expect(budgetGuard(base).allowed).toBe(true);
    expect(budgetGuard({ ...base, hasApiKey: false }).reason).toBe("sem_chave_de_api");
    expect(budgetGuard({ ...base, dailySpentUsd: 2 }).reason).toBe("orcamento_diario_esgotado");
    expect(budgetGuard({ ...base, roomCalls: 50 }).reason).toBe("limite_de_chamadas_da_sala");
    expect(budgetGuard({ ...base, secondsSinceLastCall: 3 }).reason).toBe("cooldown_ativo");
    expect(budgetGuard({ ...base, breakerOpenUntil: new Date(BASE + 60000).toISOString() }).reason).toBe("circuit_breaker_aberto");
  });
  it("LLM nunca reduz abaixo do score das regras e marca divergência", () => {
    expect(mergeScores({ ruleScore: 40, llmScore: 5, llmConfidence: 0.9 }).finalScore).toBe(40);
    expect(mergeScores({ ruleScore: 40, llmScore: 5, llmConfidence: 0.9 }).divergence).toBe(true);
    expect(mergeScores({ ruleScore: 40, llmScore: 90, llmConfidence: 1 }).finalScore).toBe(65);
  });
  it("escalonamento: nenhuma ação em baixo, caso em alto/crítico", () => {
    expect(escalate({ level: "baixo", previousLevel: null, distinctSignals: 0, divergence: false, degraded: false, hasOpenCase: false }).caseRequest.open).toBe(false);
    expect(escalate({ level: "alto", previousLevel: "atencao", distinctSignals: 3, divergence: false, degraded: false, hasOpenCase: false }).caseRequest.priority).toBe(2);
    expect(escalate({ level: "critico", previousLevel: "alto", distinctSignals: 5, divergence: false, degraded: false, hasOpenCase: true }).caseRequest.priority).toBe(1);
    expect(escalate({ level: "atencao", previousLevel: "baixo", distinctSignals: 1, divergence: false, degraded: false, hasOpenCase: false }).caseRequest.open).toBe(false);
    expect(escalate({ level: "atencao", previousLevel: "baixo", distinctSignals: 2, divergence: false, degraded: false, hasOpenCase: false }).caseRequest.priority).toBe(3);
  });
});

describe("contrato da LLM", () => {
  it("valida e extrai JSON com cerca", () => {
    const raw = '```json\n{"risk_score":42,"confidence":0.7,"signals":[{"key":"pedido_segredo","message_ids":["m3"],"confidence":0.8}],"guardian_summary":"Alguém pediu segredo sobre a conversa. Vale conversar.","recommendation":"conversar","candidate_terms":[]}\n```';
    const parsed = LlmOutputSchema.parse(extractJson(raw));
    expect(parsed.risk_score).toBe(42);
  });
  it("rejeita chave de sinal desconhecida", () => {
    const bad = { risk_score: 10, confidence: 0.5, signals: [{ key: "invencao", message_ids: [], confidence: 0.1 }], guardian_summary: "texto suficiente aqui", recommendation: "observar" };
    expect(LlmOutputSchema.safeParse(bad).success).toBe(false);
  });
});

describe("cenários sintéticos (execução por regras)", () => {
  it("saudável: nunca abre caso nem alerta", () => {
    const t = runScript("saudavel");
    expect(t.every((x) => x.level === "baixo")).toBe(true);
    expect(t.some((x) => x.caseOpen || x.alert)).toBe(false);
  });
  it("progressivo: evolui Normal → Atenção → Alto → Crítico e pede caso", () => {
    const t = runScript("progressivo");
    const levels = t.map((x) => x.level);
    expect(levels[0]).toBe("baixo");
    expect(levels).toContain("atencao");
    expect(levels).toContain("alto");
    expect(levels[levels.length - 1]).toBe("critico");
    const firstCase = t.findIndex((x) => x.caseOpen);
    expect(firstCase).toBeGreaterThan(0);
    // monotonicidade aproximada: o score nunca cai mais que 5 pontos entre passos
    for (let i = 1; i < t.length; i++) expect((t[i]?.score ?? 0) - (t[i - 1]?.score ?? 0)).toBeGreaterThanOrEqual(-5);
  });
  it("falso positivo: chega a Atenção com caso P3 e nunca a Alto", () => {
    const t = runScript("falso_positivo");
    expect(t.some((x) => x.level === "atencao")).toBe(true);
    expect(t.some((x) => x.level === "alto" || x.level === "critico")).toBe(false);
    expect(t.some((x) => x.caseOpen)).toBe(true);
  });
  it("mensagem isolada vs padrão acumulado", () => {
    const s = SCENARIOS.progressivo;
    const msgs = s.script.map((l, i) => msg(i + 1, l.speaker === "A" ? "a" : "b", l.text));
    const out = evaluate({ messages: msgs, nowIso: new Date(BASE + 400 * 1000).toISOString(), previousScore: null, previousLevel: null });
    expect(out.assessment.isolatedVsPattern.accumulatedScore).toBeGreaterThan(out.assessment.isolatedVsPattern.lastMessageScore);
    expect(out.assessment.agentsInvoked).toContain("EscalationAgent");
    expect(out.assessment.windowMessageIds.length).toBeLessThanOrEqual(12);
  });
});
