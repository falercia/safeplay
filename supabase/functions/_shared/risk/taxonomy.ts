import type { SignalKey } from "./types.ts";

export interface SignalDefinition {
  key: SignalKey;
  label: string;
  /** peso base no score longitudinal */
  weight: number;
  /** explicação em linguagem simples para o responsável */
  plain: string;
  /** o que o moderador deve observar */
  moderator: string;
}

export const SIGNAL_DEFINITIONS: Record<SignalKey, SignalDefinition> = {
  vinculo_progressivo: {
    key: "vinculo_progressivo",
    label: "Vínculo progressivo",
    weight: 10,
    plain: "Alguém tenta criar uma ligação especial e exclusiva com a criança.",
    moderator: "Elogios de exclusividade, 'só você me entende', construção de intimidade acelerada.",
  },
  insistencia: {
    key: "insistencia",
    label: "Insistência",
    weight: 6,
    plain: "Alguém pressiona por respostas repetidamente.",
    moderator: "Cobrança de resposta, repetição, pressão temporal.",
  },
  teste_limites: {
    key: "teste_limites",
    label: "Teste de limites",
    weight: 12,
    plain: "Perguntas sobre supervisão, rotina ou o que a criança 'pode' fazer.",
    moderator: "Sondagem sobre presença dos pais, horários sozinho, regras da casa.",
  },
  pedido_segredo: {
    key: "pedido_segredo",
    label: "Pedido de segredo",
    weight: 16,
    plain: "Alguém pede para a criança não contar algo a ninguém.",
    moderator: "Solicitação de sigilo sobre a conversa ou sobre a relação.",
  },
  isolamento: {
    key: "isolamento",
    label: "Isolamento",
    weight: 14,
    plain: "Alguém tenta afastar a criança de pais, amigos ou outros adultos.",
    moderator: "Desqualificação de pais/amigos, 'ninguém te entende como eu'.",
  },
  informacao_pessoal: {
    key: "informacao_pessoal",
    label: "Informação pessoal",
    weight: 12,
    plain: "Alguém pede idade, endereço, escola, telefone ou fotos.",
    moderator: "Coleta de dados identificáveis ou de localização.",
  },
  migracao_canal: {
    key: "migracao_canal",
    label: "Migração para canal externo",
    weight: 16,
    plain: "Alguém sugere continuar a conversa fora do jogo, em outro aplicativo.",
    moderator: "Tentativa de sair do ambiente moderado para canal privado.",
  },
  recompensa_promessa: {
    key: "recompensa_promessa",
    label: "Recompensa ou promessa",
    weight: 12,
    plain: "Alguém oferece presentes, itens ou vantagens em troca de algo.",
    moderator: "Oferta de itens/dinheiro/vantagem condicionada a comportamento.",
  },
  coercao: {
    key: "coercao",
    label: "Coerção",
    weight: 18,
    plain: "Alguém usa ameaças, culpa ou chantagem.",
    moderator: "Ameaça de exposição, cobrança de 'dívida', ultimato.",
  },
  linguagem_codificada: {
    key: "linguagem_codificada",
    label: "Linguagem codificada (sintética)",
    weight: 12,
    plain: "Uso de códigos combinados para disfarçar a intenção. Neste POC os códigos são fictícios.",
    moderator: "Termo do glossário sintético aprovado ou candidato em revisão.",
  },
  conteudo_inadequado: {
    key: "conteudo_inadequado",
    label: "Conteúdo inadequado",
    weight: 16,
    plain: "Menção a conteúdo impróprio para a idade.",
    moderator: "Referência a material ou site impróprio para menores, sem detalhamento.",
  },
};

export const SIGNAL_LIST = Object.values(SIGNAL_DEFINITIONS);
