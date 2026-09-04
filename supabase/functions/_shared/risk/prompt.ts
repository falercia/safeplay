import type { WindowMessage } from "./types.ts";
import { SIGNAL_LIST } from "./taxonomy.ts";
import type { GlossaryTerm } from "./glossary.ts";

/**
 * Prompt único e curto. Pede saída JSON estrita, baseada em evidências (IDs de mensagens).
 * Não pede raciocínio passo a passo: a explicação exposta é sempre por evidências.
 */
export function buildSystemPrompt(glossary: GlossaryTerm[]): string {
  const taxonomy = SIGNAL_LIST.map((s) => `- ${s.key}: ${s.moderator}`).join("\n");
  const approved = glossary.filter((g) => g.status === "approved").map((g) => `"${g.term}" → ${g.signal}`).join("; ");
  return [
    "Você é o módulo de análise longitudinal do Safe Play, um POC acadêmico de segurança infantil em chats de jogos.",
    "Todos os dados são sintéticos. Avalie a JANELA COMPLETA como padrão acumulado, nunca apenas a última frase.",
    "Nunca afirme que alguém é criminoso ou agressor. Use 'sinais de risco' e 'hipótese sujeita a validação humana'.",
    "Não reproduza nem elabore conteúdo inadequado. Não invente mensagens. Referencie apenas IDs fornecidos.",
    "",
    "Taxonomia de sinais (use apenas estas chaves):",
    taxonomy,
    "",
    `Glossário sintético aprovado (códigos fictícios): ${approved || "nenhum"}.`,
    "Se notar um termo incomum usado como código, liste em candidate_terms; ele NÃO vira sinal sem revisão humana.",
    "",
    "Responda SOMENTE com um objeto JSON válido, sem texto extra, no formato:",
    '{"risk_score":0-100,"confidence":0-1,"signals":[{"key":"<chave>","message_ids":["id"],"confidence":0-1,"note":"<até 160 caracteres, sem citar a mensagem inteira>"}],"guardian_summary":"<2 a 3 frases em português simples para um responsável, sem jargão, sem acusar>","recommendation":"observar|conversar|revisar|acionar_suporte_humano","candidate_terms":[{"term":"","reason":""}]}',
  ].join("\n");
}

export function buildUserPrompt(window: WindowMessage[], ruleScore: number, ruleSignals: string[]): string {
  const lines = window.map((m) => `[${m.id}] (${m.senderId.slice(0, 8)}) ${m.content.replace(/\s+/g, " ").slice(0, 500)}`);
  return [
    `Score determinístico atual: ${ruleScore}. Sinais das regras: ${ruleSignals.join(", ") || "nenhum"}.`,
    "Janela recente (id, remetente abreviado, texto):",
    ...lines,
    "",
    "Avalie o padrão acumulado e responda apenas com o JSON.",
  ].join("\n");
}
