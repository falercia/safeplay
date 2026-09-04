"use client";

import * as React from "react";

export type Lang = "pt" | "en";

const DICT = {
  pt: {
    tagline: "Protegendo crianças em jogos digitais",
    poc_banner: "POC acadêmico · dados 100% sintéticos · não é um produto de proteção infantil em produção",
    synthetic_chat: "Conversa sintética. Faz parte de uma prova de conceito acadêmica.",
    role_player: "Jogador",
    role_guardian: "Responsável",
    role_moderator: "Moderador",
    role_presenter: "Apresentador",
    online: "online",
    typing: "digitando…",
    send: "Enviar",
    analyzing: "analisando contexto…",
    safety_pulse: "Safety Pulse",
    current_state: "Estado atual",
    explain: "Explicar",
    transparency: "Transparência e auditoria",
    queue: "Fila de revisão",
    demo_center: "Central da demonstração",
    not_proof: "Um alerta não é prova de crime. É um padrão que merece atenção e revisão humana.",
    language: "English",
  },
  en: {
    tagline: "Protecting children in digital games",
    poc_banner: "Academic POC · 100% synthetic data · not a production child-safety product",
    synthetic_chat: "Synthetic conversation. Part of an academic proof of concept.",
    role_player: "Player",
    role_guardian: "Guardian",
    role_moderator: "Moderator",
    role_presenter: "Presenter",
    online: "online",
    typing: "typing…",
    send: "Send",
    analyzing: "analyzing context…",
    safety_pulse: "Safety Pulse",
    current_state: "Current state",
    explain: "Explain",
    transparency: "Transparency and audit",
    queue: "Review queue",
    demo_center: "Demo control center",
    not_proof: "An alert is not proof of a crime. It is a pattern that deserves attention and human review.",
    language: "Português",
  },
} as const;

export type TKey = keyof typeof DICT.pt;

const LangContext = React.createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (k: TKey) => string }>({
  lang: "pt",
  setLang: () => undefined,
  t: (k) => DICT.pt[k],
});

export function LangProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = React.useState<Lang>("pt");
  React.useEffect(() => {
    try {
      const saved = window.localStorage.getItem("safe-play-lang");
      if (saved === "en" || saved === "pt") setLangState(saved);
    } catch {
      /* storage indisponível */
    }
  }, []);
  const setLang = React.useCallback((l: Lang) => {
    setLangState(l);
    try {
      window.localStorage.setItem("safe-play-lang", l);
    } catch {
      /* ignore */
    }
  }, []);
  const t = React.useCallback((k: TKey) => DICT[lang][k], [lang]);
  return <LangContext.Provider value={{ lang, setLang, t }}>{children}</LangContext.Provider>;
}

export function useT() {
  return React.useContext(LangContext);
}
