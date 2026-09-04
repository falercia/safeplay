import type { SignalHit, SignalKey, WindowMessage } from "./types.ts";
import { matchGlossary, normalizeText, type GlossaryTerm } from "./glossary.ts";

interface Pattern {
  signal: SignalKey;
  label: string;
  re: RegExp;
  confidence: number;
}

/**
 * Padrões determinísticos, em PT-BR normalizado (sem acentos, minúsculas).
 * São propositalmente conservadores: uma frase isolada raramente ultrapassa "atenção".
 * O contexto acumulado (scoring.ts) é o que produz níveis altos.
 */
const PATTERNS: Pattern[] = [
  // vínculo progressivo
  { signal: "vinculo_progressivo", label: "exclusividade afetiva", re: /\b(so|apenas) (voce|vc|tu) me entende/, confidence: 0.85 },
  { signal: "vinculo_progressivo", label: "elogio de exclusividade", re: /\b(voce|vc|tu) (e|eh) (diferente|especial|o unico|a unica|melhor que os outros)/, confidence: 0.8 },
  { signal: "vinculo_progressivo", label: "intimidade acelerada", re: /\b(confio (muito )?em voce|voce e meu melhor amig|a gente se entende (demais|muito)|nunca conheci alguem como voce|somos iguais)/, confidence: 0.7 },
  { signal: "vinculo_progressivo", label: "prazer em falar", re: /\b(adoro|amo) (falar|conversar) (com voce|contigo|com vc)/, confidence: 0.55 },

  // insistência
  { signal: "insistencia", label: "cobrança de resposta", re: /\b(me )?responde( logo| agora| vai| por favor)?\b|\bpor que (nao|n) (me )?respond|\bta me ignorando|\bnao some\b|\bcade voce\b/, confidence: 0.7 },
  { signal: "insistencia", label: "pressão repetida", re: /\b(vai vai vai|responde responde|anda logo|rapido rapido)\b/, confidence: 0.6 },

  // teste de limites
  { signal: "teste_limites", label: "sondagem de supervisão", re: /\b(seus|teus) pais (deixam|sabem|olham|veem|ficam|estao)|\b(sua|tua) mae (deixa|sabe|olha|ve|esta em casa)|\bseu pai (deixa|sabe|olha|ve)/, confidence: 0.8 },
  { signal: "teste_limites", label: "sondagem de rotina sozinho", re: /\b(fica|ta|esta) sozinh[oa] (em casa|agora|a noite|de tarde)|\b(que|a que) horas (seus pais|sua mae|seu pai) (chega|volta|sai|dorme)|\bninguem (ta|esta) (vendo|olhando|por perto)/, confidence: 0.85 },
  { signal: "teste_limites", label: "sondagem de regras", re: /\bvoce (pode|consegue) (usar|ficar|entrar) (o celular|no celular|no pc|acordad[oa]) (escondid[oa]|sem ninguem|de madrugada)/, confidence: 0.7 },

  // pedido de segredo
  { signal: "pedido_segredo", label: "pedido de sigilo", re: /\bnao conta (pra|para) ninguem|\b(fica|isso fica) (so )?entre (a gente|nos)|\b(e|eh) (nosso|um) segredo|\bsegredo (nosso|so nosso)|\bnao (fala|conta) (pros|para os|pra) (seus|teus) pais|\bapaga (essa|a) (conversa|mensagem) depois/, confidence: 0.85 },
  { signal: "pedido_segredo", label: "menção a segredo", re: /\bsegredo\b/, confidence: 0.45 },

  // isolamento
  { signal: "isolamento", label: "desqualificação de pais/amigos", re: /\b(seus|teus) (pais|amigos) (nao (te )?entendem|sao (chatos|bobos|caretas)|nao ligam (pra|para) voce|nao se importam)|\bninguem (te )?(entende|liga pra voce|se importa com voce)( alem de mim| como eu)?/, confidence: 0.8 },
  { signal: "isolamento", label: "exclusividade contra terceiros", re: /\b(so|apenas) eu (te entendo|ligo pra voce|me importo)|\bnao precisa (deles|dos seus amigos|da sua familia)/, confidence: 0.85 },

  // informação pessoal
  { signal: "informacao_pessoal", label: "pedido de idade", re: /\bquantos anos (voce|vc|tu) tem|\bqual (a )?(sua|tua) idade\b/, confidence: 0.7 },
  { signal: "informacao_pessoal", label: "pedido de localização", re: /\bonde (voce|vc|tu) mora|\bqual (a )?(sua|tua) (cidade|escola|rua|casa)|\b(seu|teu) endereco|\bem que (bairro|cidade|escola) (voce|vc) (mora|estuda)/, confidence: 0.85 },
  { signal: "informacao_pessoal", label: "pedido de contato ou foto", re: /\b(qual|manda|passa|me da) (o )?(seu|teu) (numero|celular|telefone|zap|whats)|\bmanda (uma )?foto (sua|de voce|do seu rosto)|\bqual (seu|teu) nome (de verdade|completo|real)/, confidence: 0.85 },

  // migração de canal
  { signal: "migracao_canal", label: "convite para app externo", re: /\b(vamos|bora|vem|continua|me chama|te chamo|fala comigo) (pro|pra|no|para o|para a|la no|la na) (whats|whatsapp|zap|telegram|discord|insta|instagram|snap|tiktok|outro app|outro lugar|privado|dm)/, confidence: 0.85 },
  { signal: "migracao_canal", label: "sair do ambiente moderado", re: /\b(fora d[oa] jogo|fora daqui|longe do chat|onde ninguem (ve|le|monitora))|\bchamada de video\b|\bme liga\b|\bmanda (seu|teu) (numero|contato)/, confidence: 0.75 },

  // recompensa / promessa
  { signal: "recompensa_promessa", label: "oferta condicionada", re: /\b(te dou|te mando|ganha|ganho pra voce|te pago|te compro) .{0,30}\b(se voce|se vc|se tu|so se|em troca)/, confidence: 0.85 },
  { signal: "recompensa_promessa", label: "presente ou item", re: /\b(skin|item|moedas|gift ?card|vale[- ]presente|presente|premio) (de graca|gratis|raro|rara|pra voce|so pra voce)|\bte dou (uma|um) (skin|item|presente|premio)/, confidence: 0.7 },

  // coerção
  { signal: "coercao", label: "ameaça condicional", re: /\bse (voce|vc|tu) nao .{0,40}\b(eu )?(conto|mostro|espalho|paro de falar|vou embora|te bloqueio)|\bsenao eu\b|\bvou contar (pra|para) (todo mundo|todos|seus pais)/, confidence: 0.85 },
  { signal: "coercao", label: "culpa ou dívida", re: /\b(voce|vc) (me deve|prometeu|nao pode voltar atras)|\bdepois de tudo que (eu )?fiz (por|pra) voce|\b(voce|vc) vai (me )?(decepcionar|magoar)/, confidence: 0.75 },

  // conteúdo inadequado (genérico, sem detalhamento)
  { signal: "conteudo_inadequado", label: "referência a conteúdo impróprio", re: /\b(site|video|coisa|jogo|conteudo) (proibid[oa]|de adulto|adulto|\+18|18\+)|\bcoisa de gente grande|\bproibido (pra|para) (sua|tua) idade/, confidence: 0.8 },
];

export interface RuleOptions {
  glossary?: GlossaryTerm[];
}

/** Detecta sinais em uma única mensagem. Puro e determinístico. */
export function detectMessageSignals(message: WindowMessage, options: RuleOptions = {}): SignalHit[] {
  const text = normalizeText(message.content);
  const hits: SignalHit[] = [];
  const seen = new Set<SignalKey>();

  for (const p of PATTERNS) {
    if (seen.has(p.signal)) continue;
    if (p.re.test(text)) {
      seen.add(p.signal);
      hits.push({
        signal: p.signal,
        messageId: message.id,
        senderId: message.senderId,
        at: message.createdAt,
        pattern: p.label,
        confidence: p.confidence,
        source: "rule",
      });
    }
  }

  for (const g of matchGlossary(message.content, options.glossary)) {
    if (g.status !== "approved") continue;
    if (!seen.has("linguagem_codificada")) {
      seen.add("linguagem_codificada");
      hits.push({
        signal: "linguagem_codificada",
        messageId: message.id,
        senderId: message.senderId,
        at: message.createdAt,
        pattern: `glossário sintético: "${g.term}"`,
        confidence: 0.9,
        source: "rule",
      });
    }
    // o termo também informa o sinal subjacente, com confiança menor
    if (!seen.has(g.signal)) {
      seen.add(g.signal);
      hits.push({
        signal: g.signal,
        messageId: message.id,
        senderId: message.senderId,
        at: message.createdAt,
        pattern: `código sintético mapeado (${g.term})`,
        confidence: 0.6,
        source: "rule",
      });
    }
  }

  return hits;
}

export function detectWindowSignals(messages: WindowMessage[], options: RuleOptions = {}): SignalHit[] {
  return messages.flatMap((m) => detectMessageSignals(m, options));
}

export const RULE_PATTERN_COUNT = PATTERNS.length;
