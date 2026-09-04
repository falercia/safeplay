import type { SignalKey } from "./types.ts";

/**
 * Glossário SINTÉTICO. Todos os termos abaixo foram inventados para este POC
 * e não correspondem a códigos reais usados por qualquer comunidade.
 * A base operacional real teria de ser curada por especialistas em Trust & Safety.
 */
export interface GlossaryTerm {
  term: string;
  /** sinal ao qual o termo é mapeado */
  signal: SignalKey;
  status: "approved" | "candidate" | "rejected";
  version: number;
  notes: string;
}

export const SYNTHETIC_GLOSSARY: GlossaryTerm[] = [
  { term: "modo fantasma", signal: "pedido_segredo", status: "approved", version: 1, notes: "[sintético] combinado para 'não contar a ninguém'" },
  { term: "portal zp", signal: "migracao_canal", status: "approved", version: 1, notes: "[sintético] nome fictício de app externo" },
  { term: "cofre azul", signal: "recompensa_promessa", status: "approved", version: 1, notes: "[sintético] promessa de item raro em troca de algo" },
  { term: "mapa da casa", signal: "informacao_pessoal", status: "approved", version: 1, notes: "[sintético] pedido de endereço/rotina" },
  { term: "nivel 99 de confiança", signal: "vinculo_progressivo", status: "approved", version: 1, notes: "[sintético] intimidade acelerada" },
  { term: "chave lunar", signal: "conteudo_inadequado", status: "approved", version: 1, notes: "[sintético] referência a conteúdo impróprio" },
];

export interface GlossaryMatch {
  term: string;
  signal: SignalKey;
  status: GlossaryTerm["status"];
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchGlossary(content: string, terms: GlossaryTerm[] = SYNTHETIC_GLOSSARY): GlossaryMatch[] {
  const text = normalize(content);
  const out: GlossaryMatch[] = [];
  for (const t of terms) {
    if (t.status === "rejected") continue;
    const needle = normalize(t.term);
    if (needle.length === 0) continue;
    const re = new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`);
    if (re.test(text)) out.push({ term: t.term, signal: t.signal, status: t.status });
  }
  return out;
}

/**
 * Heurística de candidatos (Camada 2 do deck): tokens incomuns, com marcação de
 * "código" (aspas, colchetes ou prefixo) que aparecem junto de pedido de segredo/migração.
 * Retorna apenas candidatos; nunca vira sinal sem revisão humana.
 */
export function detectCandidateTerms(content: string, known: GlossaryTerm[] = SYNTHETIC_GLOSSARY): string[] {
  const text = normalize(content);
  const marked = [...text.matchAll(/["'\[\(]([a-z0-9]{3,20}(?: [a-z0-9]{2,20})?)["'\]\)]/g)].map((m) => m[1] ?? "");
  const contextual = /segredo|codigo|palavra|fala assim|entre a gente|senha|combinado/.test(text);
  if (!contextual) return [];
  const knownSet = new Set(known.map((k) => normalize(k.term)));
  return [...new Set(marked.filter((m) => m && !knownSet.has(m)))];
}

export { normalize as normalizeText };
