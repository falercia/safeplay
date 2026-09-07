"use client";

import * as React from "react";
import Link from "next/link";
import { Gamepad2, ShieldCheck, UserRoundPen, Users } from "lucide-react";
import { GameFrame, GamePanel } from "@/components/game/game-frame";
import { Button } from "@/components/ui/button";
import { clearPlayer, loadPlayer } from "@/lib/session-store";

/** Tela inicial: só o convite para jogar. Papéis de apoio ficam no rodapé. */
export function StartScreen() {
  const [known, setKnown] = React.useState<string | null>(null);
  React.useEffect(() => {
    setKnown(loadPlayer()?.name ?? null);
  }, []);
  return (
    <GameFrame width="max-w-2xl">
      <div className="mt-[6vh] flex w-full flex-col items-center text-center">
        <span className="chip mb-4 border-safe-500/30 text-safe-300">Aventura cooperativa · 2 jogadores</span>
        <h1 className="font-display text-5xl font-bold leading-none tracking-tight text-ink-50 drop-shadow-[0_2px_12px_rgba(0,0,0,0.6)] sm:text-7xl">
          Arena <span className="text-safe-400">Nimbus</span>
        </h1>
        <p className="mt-4 max-w-md text-base text-ink-200">Junte-se a outro jogador, derrote a Sentinela de Ferro e converse pelo chat enquanto a aventura acontece.</p>
        <GamePanel className="mt-8 max-w-md">
          <Button asChild size="lg" className="h-14 w-full text-lg" data-testid="play">
            <Link href={known ? "/lobby" : "/entrar"}>
              <Gamepad2 className="!size-5" /> {known ? `Jogar como ${known}` : "Jogar"}
            </Link>
          </Button>
          {known ? (
            <button
              type="button"
              className="focus-ring mt-3 inline-flex items-center gap-1.5 text-xs text-ink-300 underline-offset-2 hover:underline"
              onClick={() => {
                clearPlayer();
                setKnown(null);
              }}
            >
              <UserRoundPen className="size-3.5" /> Não sou {known}, entrar com outro nome
            </button>
          ) : (
            <p className="mt-3 text-xs text-ink-400">Você vai precisar do código de acesso da partida.</p>
          )}
        </GamePanel>
        <ul className="mt-8 grid w-full max-w-lg grid-cols-1 gap-2 text-left text-xs text-ink-300 sm:grid-cols-2">
          <li className="flex items-start gap-2 rounded-xl border border-white/10 bg-navy-950/60 p-3">
            <Users className="mt-0.5 size-4 shrink-0 text-sky-400" />
            <span>Crie um mundo ou entre em um mundo aberto. O jogo é uma simulação: ninguém precisa controlar nada.</span>
          </li>
          <li className="flex items-start gap-2 rounded-xl border border-white/10 bg-navy-950/60 p-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-safe-400" />
            <span>O chat tem proteção contextual e revisão humana. Nada aqui é punitivo nem automático.</span>
          </li>
        </ul>
      </div>
    </GameFrame>
  );
}
