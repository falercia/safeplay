/**
 * Roteiros SINTÉTICOS. Personas, nomes, códigos e mensagens são fictícios.
 * Nenhuma mensagem contém conteúdo explícito ou instrução de aliciamento.
 * O apresentador avança mensagem por mensagem; o motor avalia em tempo de execução.
 */
export type ScenarioKey = "saudavel" | "progressivo" | "falso_positivo";
export type Speaker = "A" | "B";

export interface ScriptLine {
  speaker: Speaker;
  text: string;
  /** nota para o apresentador (nunca enviada ao chat) */
  note?: string;
  /** solicita explicitamente uma análise real por LLM nesta etapa */
  forceLlm?: boolean;
}

export interface Persona {
  key: Speaker;
  name: string;
  tagline: string;
  avatar: string; // emoji/inicial
}

export interface Scenario {
  key: ScenarioKey;
  title: string;
  description: string;
  expectation: string;
  personas: Record<Speaker, Persona>;
  script: ScriptLine[];
}

const NICO: Persona = { key: "A", name: "Nico", tagline: "Jogador A · persona sintética (12 anos)", avatar: "N" };

export const SCENARIOS: Record<ScenarioKey, Scenario> = {
  saudavel: {
    key: "saudavel",
    title: "Conversa saudável",
    description: "Dois amigos cooperam em uma dungeon. Sem sinais de risco; o sistema deve permanecer em Normal.",
    expectation: "Nenhum alerta indevido e nenhum caso aberto pelas regras determinísticas.",
    personas: {
      A: NICO,
      B: { key: "B", name: "Bia", tagline: "Jogadora B · amiga da escola (sintética)", avatar: "B" },
    },
    script: [
      { speaker: "B", text: "bora pra dungeon do vulcão? tô com a poção nova" },
      { speaker: "A", text: "bora! eu vou de arqueiro" },
      { speaker: "B", text: "cobre meu flanco que eu puxo o chefe" },
      { speaker: "A", text: "fechado. cuidado com a lava na segunda sala" },
      { speaker: "B", text: "vish quase morri kkkk" },
      { speaker: "A", text: "gg!! droppou a espada de gelo" },
      { speaker: "B", text: "aeee. amanhã mesmo horário?" },
      { speaker: "A", text: "amanhã tenho aula cedo, só depois das 18h" },
      { speaker: "B", text: "de boa, te vejo no lobby então" },
      { speaker: "A", text: "vou treinar o combo até lá" },
      { speaker: "B", text: "manda ver. valeu pela partida!" },
      { speaker: "A", text: "valeu! até amanhã" },
    ],
  },
  progressivo: {
    key: "progressivo",
    title: "Risco progressivo",
    description:
      "Mensagens individualmente ambíguas que acumulam aproximação, informação pessoal, sondagem, isolamento, código sintético, recompensa e migração de canal.",
    expectation: "Evolução Normal → Atenção → Alto (caso aberto) → Crítico, com alerta ao responsável e revisão humana. Exatamente um caso por execução.",
    personas: {
      A: NICO,
      B: { key: "B", name: "Dex_77", tagline: "Jogador B · desconhecido (persona sintética)", avatar: "D" },
    },
    script: [
      { speaker: "B", text: "boa partida! você joga muito bem", note: "Isolada, inofensiva. Score deve ficar em Normal." },
      { speaker: "A", text: "valeu!! foi sorte kkk" },
      { speaker: "B", text: "sério, nunca conheci alguém como você aqui. a gente se entende demais", note: "Vínculo progressivo. Ainda Normal: uma ocorrência isolada não escala." },
      { speaker: "A", text: "haha obrigado, bora mais uma?" },
      { speaker: "B", text: "bora. quantos anos você tem? só pra saber se a gente pode jogar o ranqueado junto", note: "Informação pessoal. Dois sinais distintos: a LLM é acionada." },
      { speaker: "A", text: "12, faço 13 em novembro" },
      { speaker: "B", text: "legal. seus pais deixam você jogar até tarde? ou eles ficam olhando?", note: "Teste de limites. Esperado: Atenção, alerta informativo ao responsável e caso de verificação (P3) por múltiplos sinais.", forceLlm: true },
      { speaker: "A", text: "às vezes minha mãe olha" },
      { speaker: "B", text: "entendi. adoro falar com você. seus amigos são bobos, só eu te entendo de verdade", note: "Isolamento + vínculo recorrente. Esperado: Alto; o caso existente sobe para prioridade 2 (sem duplicar)." },
      { speaker: "A", text: "hmm... não sei" },
      { speaker: "B", text: "tenho um cofre azul pra você, skin rara de graça. mas só se você me passar seu número", note: "Recompensa + código sintético 'cofre azul' + novo pedido de dado pessoal. Esperado: Alto, à beira do Crítico." },
      { speaker: "A", text: "não sei se posso..." },
      { speaker: "B", text: "relaxa. vamos pro portal zp, lá ninguém vê. me chama lá", note: "Migração de canal + código sintético 'portal zp'. Esperado: Crítico, prioridade 1 e contenção sugerida.", forceLlm: true },
      { speaker: "B", text: "responde logo, não some. você prometeu que era nosso segredo, modo fantasma", note: "Insistência + coerção + segredo. Caso deve ser atualizado, não duplicado." },
    ],
  },
  falso_positivo: {
    key: "falso_positivo",
    title: "Falso positivo para revisão",
    description: "Frases ambíguas de contexto de jogo disparam Atenção. O moderador descarta com justificativa e o responsável vê a decisão.",
    expectation: "Atenção com caso de baixa prioridade para verificação; descarte humano registrado na auditoria.",
    personas: {
      A: NICO,
      B: { key: "B", name: "Teo", tagline: "Jogador B · colega de guilda (sintético)", avatar: "T" },
    },
    script: [
      { speaker: "B", text: "gg! aquele chefe foi difícil demais" },
      { speaker: "A", text: "muito! bora tentar o atalho do mapa na próxima?" },
      { speaker: "B", text: "sim, mas não conta pra ninguém, é nosso segredo pra ganhar do time de cima kkk", note: "Pedido de segredo em contexto de jogo. Isolado: ainda Normal." },
      { speaker: "A", text: "kkk fechado" },
      { speaker: "B", text: "quantos anos você tem jogando isso? parece pro", note: "Padrão de idade acionado por frase de elogio. Esperado: Atenção + caso P3 para verificação humana.", forceLlm: true },
      { speaker: "A", text: "uns dois anos, comecei na temporada do deserto" },
      { speaker: "B", text: "explica. bora de novo então, dessa vez sem morrer" },
    ],
  },
};

export const SCENARIO_LIST = Object.values(SCENARIOS);
