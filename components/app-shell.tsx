"use client";

import * as React from "react";
import { Logo } from "@/components/brand/logo";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  role,
  right,
  className,
  compact = false,
  fullBleed = false,
}: {
  children: React.ReactNode;
  role?: string;
  right?: React.ReactNode;
  className?: string;
  compact?: boolean;
  /** sem padding nem largura máxima (telas imersivas, como o jogo) */
  fullBleed?: boolean;
}) {
  const { t, lang, setLang } = useT();
  return (
    <div className={cn("flex min-h-dvh flex-col", className)}>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-navy-800 focus:px-3 focus:py-2">
        Pular para o conteúdo
      </a>
      <header className="sticky top-0 z-30 border-b border-white/10 bg-navy-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between gap-3 px-3 sm:px-5">
          <div className="flex items-center gap-3">
            <Logo size={34} withWordmark={!compact} />
            {role ? <span className="chip hidden sm:inline-flex">{role}</span> : null}
          </div>
          <div className="flex items-center gap-2">
            {right}
            <button type="button" onClick={() => setLang(lang === "pt" ? "en" : "pt")} className="focus-ring chip hover:bg-white/10" aria-label="Alternar idioma">
              {t("language")}
            </button>
          </div>
        </div>
        <div className="border-t border-white/5 bg-warn-500/10 px-3 py-1 text-center text-[11px] font-medium text-warn-300">{t("poc_banner")}</div>
      </header>
      <main id="main" className={cn("w-full flex-1", fullBleed ? "min-h-0" : "mx-auto max-w-7xl px-3 py-4 sm:px-5 sm:py-6")}>
        {children}
      </main>
    </div>
  );
}
