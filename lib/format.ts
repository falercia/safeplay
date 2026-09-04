import type { Level, Recommendation, SignalKey, Trend } from "@risk/index.ts";
import { LEVEL_LABEL, RECOMMENDATION_DETAIL, RECOMMENDATION_LABEL, SIGNAL_DEFINITIONS } from "@risk/index.ts";

export const levelLabel = (l: Level): string => LEVEL_LABEL[l];
export const recommendationLabel = (r: Recommendation): string => RECOMMENDATION_LABEL[r];
export const recommendationDetail = (r: Recommendation): string => RECOMMENDATION_DETAIL[r];
export const signalLabel = (s: SignalKey): string => SIGNAL_DEFINITIONS[s]?.label ?? s;
export const signalPlain = (s: SignalKey): string => SIGNAL_DEFINITIONS[s]?.plain ?? "";

export const trendLabel: Record<Trend, string> = { subindo: "subindo", estavel: "estável", caindo: "caindo" };

export function levelClass(level: Level): string {
  return `level-${level}`;
}

export function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function formatShortTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function formatCountdown(ms: number): string {
  const neg = ms < 0;
  const abs = Math.abs(ms);
  const m = Math.floor(abs / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  return `${neg ? "-" : ""}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function formatUsd(n: number): string {
  return `US$ ${n.toFixed(4)}`;
}

export const CASE_STATUS_LABEL: Record<string, string> = {
  open: "Aberto",
  in_review: "Em revisão",
  needs_context: "Aguardando contexto",
  confirmed: "Risco confirmado",
  dismissed: "Falso positivo descartado",
  contained: "Contenção aplicada",
};

export const ACTION_LABEL: Record<string, string> = {
  confirm_risk: "Confirmar risco",
  dismiss_false_positive: "Descartar falso positivo",
  request_context: "Solicitar mais contexto",
  apply_demo_containment: "Aplicar contenção temporária (demo)",
  approve_term: "Aprovar termo do glossário",
  reject_term: "Rejeitar termo do glossário",
  reanalyze: "Reanalisar",
};

export const DEGRADED_REASON_LABEL: Record<string, string> = {
  sem_chave_de_api: "sem chave de API configurada",
  llm_desativada_pelo_apresentador: "LLM desativada pelo apresentador",
  circuit_breaker_aberto: "circuit breaker aberto após falhas consecutivas",
  orcamento_diario_esgotado: "orçamento diário esgotado",
  limite_de_chamadas_da_sala: "limite de chamadas da sala atingido",
  cooldown_ativo: "cooldown entre chamadas",
  resposta_invalida_da_llm: "resposta da LLM inválida após reparação",
  llm_timeout: "tempo limite da LLM excedido",
  llm_rate_limited: "provedor limitou a taxa",
  llm_unauthorized: "chave de API rejeitada",
  llm_provider_unavailable: "provedor indisponível",
  llm_network_error: "erro de rede ao chamar a LLM",
  llm_forced_failure: "falha forçada pelo apresentador (plano B)",
};

export function degradedReasonLabel(code: string | null | undefined): string {
  if (!code) return "";
  return DEGRADED_REASON_LABEL[code] ?? code.replace(/_/g, " ");
}

export const TRIGGER_REASON_LABEL: Record<string, string> = {
  regra_acima_do_limiar_de_atencao: "regra acima do limiar de atenção",
  dois_ou_mais_sinais_na_janela: "dois ou mais sinais na janela",
  novas_mensagens_desde_ultima_analise: "novas mensagens desde a última análise",
  reanalise_solicitada_pelo_moderador: "reanálise solicitada pelo moderador",
  cenario_da_demo_solicitou_analise_real: "cenário da demo solicitou análise real",
};
