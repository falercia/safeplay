"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { DoorOpen, Loader2, LogOut, Plus, RadioTower, Users, WifiOff } from "lucide-react";
import { GameFrame, GamePanel } from "@/components/game/game-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { usePlayer, friendlyError } from "@/lib/hooks/use-player";
import { useLiveTable } from "@/lib/hooks/use-live-table";
import { callFunction } from "@/lib/api";
import type { GameEnterResult, RoomMemberRow, WorldJoinResult, WorldLobbyRow } from "@/lib/types";
import { formatShortTime } from "@/lib/format";
import { cn } from "@/lib/utils";

const WORLD_NAMES = ["Vale das Brumas", "Torre do Relâmpago", "Floresta de Vidro", "Ruínas de Ferro", "Ponte dos Ventos", "Cidadela Azul"];

export function LobbyScreen() {
  const router = useRouter();
  const player = usePlayer();

  React.useEffect(() => {
    if (player.status === "anonymous") router.replace("/entrar");
  }, [player.status, router]);

  if (player.status !== "ready") {
    return (
      <GameFrame width="max-w-md">
        <GamePanel className="mt-[10vh] flex items-center gap-3 text-sm text-ink-200">
          {player.status === "error" ? (
            <span className="text-warn-300">{player.message}</span>
          ) : (
            <>
              <Loader2 className="size-5 animate-spin text-safe-400" /> Preparando o lobby…
            </>
          )}
        </GamePanel>
      </GameFrame>
    );
  }
  return <LobbyInner data={player.data} signOut={player.signOut} />;
}

function LobbyInner({ data, signOut }: { data: GameEnterResult; signOut: () => void }) {
  const router = useRouter();
  const me = data.profile;
  const [name, setName] = React.useState(() => WORLD_NAMES[Math.floor(Math.random() * WORLD_NAMES.length)]!);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const members = useLiveTable<RoomMemberRow>({ table: "room_members", filter: null, select: "room_id, profile_id, joined_at", rowKey: (r) => `${r.room_id}:${r.profile_id}` });
  const worlds = useLiveTable<WorldLobbyRow>({
    table: "worlds",
    source: "world_lobby",
    filter: { column: "session_id", value: me.session_id },
    orderBy: { column: "created_at", ascending: false },
    limit: 30,
    refetchKey: members.rows.length,
  });
  const open = worlds.rows.filter((w) => w.status === "open");
  const [currentWorld, setCurrentWorld] = React.useState<string | null>(data.currentWorldCode);
  const mine = open.find((w) => w.code === currentWorld) ?? null;

  async function leave() {
    setBusy("leave");
    setError(null);
    try {
      await callFunction("world-leave", {});
      setCurrentWorld(null);
    } catch (e) {
      setError(friendlyError(e).message);
    } finally {
      setBusy(null);
    }
  }

  async function create() {
    setBusy("create");
    setError(null);
    try {
      const res = await callFunction<WorldJoinResult>("world-create", { name: name.trim() });
      router.push(`/mundo/${res.world.code}`);
    } catch (e) {
      setError(friendlyError(e).message);
      setBusy(null);
    }
  }

  async function join(code: string) {
    setBusy(code);
    setError(null);
    try {
      await callFunction<WorldJoinResult>("world-join", { worldCode: code });
      router.push(`/mundo/${code}`);
    } catch (e) {
      setError(friendlyError(e, { world_full: "Esse mundo já está cheio. Crie outro ou escolha um com vaga.", world_closed: "Esse mundo foi encerrado." }).message);
      setBusy(null);
    }
  }

  return (
    <GameFrame
      width="max-w-3xl"
      right={
        <>
          <span className={cn("chip", worlds.connected ? "text-safe-300" : "text-warn-300")} title="Lista de mundos em tempo real">
            {worlds.connected ? <RadioTower className="size-3.5" /> : <WifiOff className="size-3.5" />}
            <span className="hidden sm:inline">{worlds.connected ? "lobby ao vivo" : "conectando"}</span>
          </span>
          <span className="chip">{me.display_name}</span>
          <Button variant="ghost" size="sm" onClick={() => { signOut(); router.replace("/entrar"); }} aria-label="Sair">
            <LogOut />
          </Button>
        </>
      }
    >
      <div className="mt-2 w-full">
        <h1 className="font-display text-3xl font-bold">Olá, {me.display_name}.</h1>
        <p className="mt-1 text-sm text-ink-300">Crie um mundo novo ou entre em um mundo aberto. Cada mundo recebe dois jogadores.</p>

        {error ? (
          <p role="alert" className="mt-4 rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-300">
            {error}
          </p>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1.3fr]">
          <GamePanel>
            <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
              <Plus className="size-5 text-safe-400" /> Criar mundo
            </h2>
            <p className="mt-1 text-xs text-ink-400">Você entra como primeiro jogador e outra pessoa pode se juntar.</p>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} minLength={2} required aria-label="Nome do mundo" data-testid="world-name" />
              <Button type="submit" size="lg" disabled={busy !== null || name.trim().length < 2} data-testid="create-world">
                {busy === "create" ? <Loader2 className="animate-spin" /> : <Plus />} Criar e entrar
              </Button>
            </form>
            {mine ? (
              <div className="mt-4 rounded-xl border border-safe-500/30 bg-safe-500/10 p-3 text-xs text-ink-100">
                Você já está em <strong>{mine.name}</strong>.{" "}
                <button type="button" className="font-semibold text-safe-300 underline" onClick={() => router.push(`/mundo/${mine.code}`)}>
                  Voltar para o mundo
                </button>
                {" · "}
                <button type="button" className="font-semibold text-warn-300 underline" onClick={() => void leave()} disabled={busy !== null} data-testid="leave-world">
                  Sair do mundo
                </button>
              </div>
            ) : null}
          </GamePanel>

          <GamePanel>
            <h2 className="font-display flex items-center gap-2 text-lg font-semibold">
              <DoorOpen className="size-5 text-sky-400" /> Mundos abertos
            </h2>
            <ul className="mt-3 flex max-h-[50vh] flex-col gap-2 overflow-y-auto scrollbar-thin" data-testid="world-list">
              {worlds.loading ? <li className="text-sm text-ink-400">Carregando…</li> : null}
              {!worlds.loading && open.length === 0 ? <li className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-ink-400">Nenhum mundo aberto agora. Crie o primeiro.</li> : null}
              {open.map((w) => {
                const full = w.players >= w.max_players;
                const inside = w.code === currentWorld;
                return (
                  <li key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-navy-900/60 p-3" data-testid="world-item" data-code={w.code}>
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{w.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
                        <span className="font-mono">{w.code}</span>
                        <span className="inline-flex items-center gap-1">
                          <Users className="size-3" /> {w.players}/{w.max_players}
                        </span>
                        <span>{w.player_names || "vazio"}</span>
                        <span>{formatShortTime(w.created_at)}</span>
                      </div>
                    </div>
                    <Button size="sm" variant={inside ? "secondary" : full ? "outline" : "primary"} disabled={busy !== null || (full && !inside)} onClick={() => void join(w.code)} data-testid="join-world">
                      {busy === w.code ? <Loader2 className="animate-spin" /> : null} {inside ? "Voltar" : full ? "Cheio" : "Entrar"}
                    </Button>
                  </li>
                );
              })}
            </ul>
          </GamePanel>
        </div>
      </div>
    </GameFrame>
  );
}
