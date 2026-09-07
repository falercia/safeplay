"use client";

import * as React from "react";
import { Loader2, LogOut, RadioTower, Users, WifiOff } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useLiveTable } from "@/lib/hooks/use-live-table";
import { callFunction } from "@/lib/api";
import { friendlyError } from "@/lib/hooks/use-player";
import type { RoomMemberRow, WorldLobbyRow } from "@/lib/types";
import { formatShortTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Props<T> {
  sessionId: string;
  roleLabel: string;
  title: string;
  hint: string;
  action: { name: string; body: (worldCode: string) => Record<string, unknown>; label: string; presenterCode?: string };
  onDone: (result: T) => void;
  logout?: () => void;
  includeClosed?: boolean;
}

/** Lista de mundos da sessão (tempo real) com uma ação por mundo. Usado por responsável e apresentador. */
export function WorldPicker<T>({ sessionId, roleLabel, title, hint, action, onDone, logout, includeClosed = false }: Props<T>) {
  const members = useLiveTable<RoomMemberRow>({ table: "room_members", filter: null, select: "room_id, profile_id, joined_at", rowKey: (r) => `${r.room_id}:${r.profile_id}` });
  const worlds = useLiveTable<WorldLobbyRow>({ table: "worlds", source: "world_lobby", filter: { column: "session_id", value: sessionId }, orderBy: { column: "created_at", ascending: false }, limit: 40, refetchKey: members.rows.length });
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const list = worlds.rows.filter((w) => includeClosed || w.status === "open");

  async function pick(code: string) {
    setBusy(code);
    setError(null);
    try {
      const res = await callFunction<T>(action.name, action.body(code), action.presenterCode ? { presenterCode: action.presenterCode } : {});
      onDone(res);
    } catch (e) {
      setError(friendlyError(e).message);
      setBusy(null);
    }
  }

  return (
    <AppShell
      role={roleLabel}
      right={
        <>
          <span className={cn("chip", worlds.connected ? "text-safe-300" : "text-warn-300")}>
            {worlds.connected ? <RadioTower className="size-3.5" /> : <WifiOff className="size-3.5" />}
            <span className="hidden sm:inline">{worlds.connected ? "ao vivo" : "conectando"}</span>
          </span>
          {logout ? (
            <Button variant="ghost" size="sm" onClick={logout} aria-label="Sair">
              <LogOut />
            </Button>
          ) : null}
        </>
      }
    >
      <Card strong className="mx-auto mt-6 max-w-2xl">
        <CardTitle>{title}</CardTitle>
        <p className="mt-1 text-sm text-ink-300">{hint}</p>
        {error ? (
          <p role="alert" className="mt-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-3 py-2 text-xs text-warn-300">
            {error}
          </p>
        ) : null}
        <ul className="mt-4 flex flex-col gap-2" data-testid="world-picker">
          {worlds.loading ? <li className="text-sm text-ink-400">Carregando mundos…</li> : null}
          {!worlds.loading && list.length === 0 ? <li className="rounded-xl border border-dashed border-white/10 p-4 text-center text-sm text-ink-400">Nenhum mundo aberto. Peça a um jogador para criar um na tela inicial.</li> : null}
          {list.map((w) => (
            <li key={w.id} className="flex items-center justify-between gap-3 rounded-xl border border-white/10 p-3" data-testid="world-option" data-code={w.code}>
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  {w.name} {w.status === "closed" ? <span className="chip ml-1 text-ink-400">encerrado</span> : null}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-ink-400">
                  <span className="font-mono">{w.code}</span>
                  <span className="inline-flex items-center gap-1">
                    <Users className="size-3" /> {w.players}/{w.max_players}
                  </span>
                  <span>{w.player_names || "vazio"}</span>
                  <span>criado por {w.creator_name ?? "—"} · {formatShortTime(w.created_at)}</span>
                </div>
              </div>
              <Button size="sm" disabled={busy !== null} onClick={() => void pick(w.code)} data-testid="pick-world">
                {busy === w.code ? <Loader2 className="animate-spin" /> : null} {action.label}
              </Button>
            </li>
          ))}
        </ul>
      </Card>
    </AppShell>
  );
}
