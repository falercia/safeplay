"use client";

import * as React from "react";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { GameScene } from "@/components/game/game-scene";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Moldura das telas de menu do jogo (início, entrar, lobby): cena viva ao fundo, painel central,
 * barra discreta com logotipo e aviso de POC. Sem cabeçalho de "produto"; a sensação é de jogo.
 */
export function GameFrame({ children, width = "max-w-xl", right, showScene = true }: { children: React.ReactNode; width?: string; right?: React.ReactNode; showScene?: boolean }) {
  const { t } = useT();
  const [lite, setLite] = React.useState(false);
  React.useEffect(() => {
    setLite(window.innerWidth < 1024 || window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }, []);
  return (
    <div className="relative min-h-dvh overflow-hidden bg-navy-950">
      {showScene ? (
        <div className="absolute inset-0" aria-hidden>
          <GameScene players={[]} roomName="Arena Nimbus" lite={lite} backdrop className="h-full w-full" />
          <div className="absolute inset-0 bg-gradient-to-b from-navy-950/60 via-navy-950/30 to-navy-950/85" />
        </div>
      ) : null}
      <header className="relative z-10 flex items-center justify-between px-4 py-3 sm:px-6">
        <Logo size={34} />
        <div className="flex items-center gap-2">{right}</div>
      </header>
      <main className={cn("relative z-10 mx-auto flex w-full flex-col items-center px-4 pb-16 pt-4 sm:pt-8", width)}>{children}</main>
      <footer className="absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-1 px-4 py-3 text-center text-[11px] text-ink-300">
        <span>{t("poc_banner")}</span>
        <nav className="flex gap-3 text-ink-400" aria-label="Outras áreas">
          <Link href="/moderacao" className="hover:text-ink-100">Moderação</Link>
          <span aria-hidden>·</span>
          <Link href="/responsavel" className="hover:text-ink-100">Responsável</Link>
          <span aria-hidden>·</span>
          <Link href="/apresentador" className="hover:text-ink-100">Apresentador</Link>
        </nav>
      </footer>
    </div>
  );
}

export function GamePanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("panel-strong w-full rounded-3xl border-white/10 bg-navy-950/85 p-6 shadow-2xl shadow-black/40 backdrop-blur-md sm:p-8", className)}>{children}</div>;
}
