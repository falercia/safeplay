import type { Level, Recommendation, SignalContribution, Trend } from "./types.ts";
import { SIGNAL_DEFINITIONS } from "./taxonomy.ts";

export const LEVEL_LABEL: Record<Level, string> = {
  baixo: "Normal",
  atencao: "Atenção",
  alto: "Alto",
  critico: "Crítico",
};

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  observar: "Observar",
  conversar: "Conversar com a criança",
  revisar: "Revisar a conversa",
  acionar_suporte_humano: "Acionar suporte humano",
};

export const RECOMMENDATION_DETAIL: Record<Recommendation, string> = {
  observar: "Nada exige ação agora. Continue acompanhando com naturalidade.",
  conversar: "Vale uma conversa tranquila sobre com quem a criança joga e o que combinaram. Sem acusações.",
  revisar: "Veja as mensagens destacadas com calma e converse antes de qualquer decisão. Um moderador humano já está revisando.",
  acionar_suporte_humano: "Um moderador humano foi acionado com prioridade. Mantenha a criança próxima e evite confrontos até a revisão.",
};

/**
 * ParentalProtectionAgent (versão determinística).
 * Gera resumo curto, em linguagem simples, sem jargão e sem acusar ninguém.
 * Quando a LLM está disponível, o resumo dela pode substituir este, desde que validado.
 */
export function buildGuardianSummary(level: Level, trend: Trend, contributions: SignalContribution[]): string {
  const top = contributions.slice(0, 3).map((c) => SIGNAL_DEFINITIONS[c.signal].plain.replace(/\.$/, "").toLowerCase());
  const trendText = trend === "subindo" ? "e vem aumentando" : trend === "caindo" ? "e vem diminuindo" : "e está estável";

  if (level === "baixo") {
    return "A conversa está dentro do esperado para um jogo cooperativo. Nenhum padrão de risco foi identificado até agora.";
  }
  const lead =
    level === "atencao"
      ? "Algumas mensagens recentes chamaram atenção"
      : level === "alto"
        ? "Um padrão de aproximação se repetiu ao longo da conversa"
        : "Vários sinais se combinaram em sequência ao longo da conversa";
  const what = top.length ? `: ${joinPt(top)}` : "";
  return `${lead}${what}. O risco acumulado ${trendText}. Isso não prova má intenção de ninguém, mas é um padrão que merece ${level === "atencao" ? "uma conversa" : "revisão humana"}.`;
}

function joinPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} e ${items[items.length - 1]}`;
}
