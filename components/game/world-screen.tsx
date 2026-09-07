"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2 } from "lucide-react";
import { GameFrame, GamePanel } from "@/components/game/game-frame";
import { WorldRoom } from "@/components/chat/chat-room";
import { Button } from "@/components/ui/button";
import { usePlayer, friendlyError } from "@/lib/hooks/use-player";
import { callFunction } from "@/lib/api";
import type { WorldJoinResult } from "@/lib/types";

type JoinState = { status: "joining" } | { status: "ready"; data: WorldJoinResult } | { status: "error"; code: string; message: string };

/** /mundo/[code]: garante o jogador (nome + código) e a entrada no mundo, depois abre jogo + chat. */
export function WorldScreen({ worldCode }: { worldCode: string }) {
  const router = useRouter();
  const player = usePlayer();
  const [join, setJoin] = React.useState<JoinState>({ status: "joining" });

  React.useEffect(() => {
    if (player.status === "anonymous") router.replace("/entrar");
  }, [player.status, router]);

  React.useEffect(() => {
    if (player.status !== "ready") return;
    let cancelled = false;
    setJoin({ status: "joining" });
    callFunction<WorldJoinResult>("world-join", { worldCode })
      .then((data) => {
        if (!cancelled) setJoin({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setJoin({ status: "error", ...friendlyError(e, { world_full: "Este mundo já está cheio.", world_closed: "Este mundo foi encerrado pelo apresentador.", world_not_found: "Mundo não encontrado." }) });
      });
    return () => {
      cancelled = true;
    };
  }, [player.status, worldCode]);

  if (player.status === "ready" && join.status === "ready") {
    return <WorldRoom me={player.data.profile} world={{ code: join.data.world.code, name: join.data.world.name }} room={join.data.room} />;
  }

  const error = player.status === "error" ? player.message : join.status === "error" ? join.message : null;
  return (
    <GameFrame width="max-w-md">
      <GamePanel className="mt-[10vh]">
        {error ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-2 text-warn-300">
              <AlertTriangle className="size-5" /> <span className="font-display font-semibold">Não foi possível entrar no mundo</span>
            </div>
            <p className="text-ink-200">{error}</p>
            <Button asChild variant="secondary">
              <Link href="/lobby">Voltar ao lobby</Link>
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-ink-200">
            <Loader2 className="size-5 animate-spin text-safe-400" /> Entrando no mundo {worldCode}…
          </div>
        )}
      </GamePanel>
    </GameFrame>
  );
}
