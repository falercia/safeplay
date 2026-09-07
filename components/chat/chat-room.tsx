"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, DoorOpen, Lock, RadioTower, SendHorizonal, ShieldCheck, Users, WifiOff } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useLiveTable } from "@/lib/hooks/use-live-table";
import { usePresence } from "@/lib/hooks/use-presence";
import { callFunction, ApiError } from "@/lib/api";
import { getSupabase } from "@/lib/supabase/client";
import type { JobRow, MessageRow, ProfileRow, RoomMemberRow, RoomRow } from "@/lib/types";
import { formatShortTime } from "@/lib/format";
import { useT } from "@/lib/i18n";
import { cn, uuid } from "@/lib/utils";
import { GameScene, type GamePlayer } from "@/components/game/game-scene";

interface LocalMessage extends MessageRow {
  status?: "sending" | "sent" | "failed";
  errorMessage?: string;
}

export interface WorldRoomProps {
  me: ProfileRow;
  world: { code: string; name: string };
  room: { id: string; code: string; name: string };
}

/** Tela do mundo: jogo (simulação) + chat da sala. O jogo não reage ao risco do chat. */
export function WorldRoom({ me, world, room: initialRoom }: WorldRoomProps) {
  const { t } = useT();
  const router = useRouter();
  const [leaving, setLeaving] = React.useState(false);
  async function leave() {
    setLeaving(true);
    try {
      await callFunction("world-leave", {});
    } catch {
      /* mesmo com falha, volta ao lobby */
    }
    router.push("/lobby");
  }
  const roomId = initialRoom.id;
  const [draft, setDraft] = React.useState("");
  const [sendError, setSendError] = React.useState<string | null>(null);
  const listRef = React.useRef<HTMLDivElement>(null);
  const pendingSends = React.useRef(new Map<string, number>());

  const members = useLiveTable<RoomMemberRow>({ table: "room_members", filter: { column: "room_id", value: roomId }, select: "room_id, profile_id, joined_at", orderBy: { column: "joined_at", ascending: true }, rowKey: (r) => `${r.room_id}:${r.profile_id}` });
  const profiles = useLiveTable<ProfileRow>({ table: "profiles", filter: { column: "session_id", value: me.session_id } });
  const roomLive = useLiveTable<RoomRow>({ table: "rooms", filter: { column: "id", value: roomId } });
  const room = roomLive.rows[0] ?? null;
  const roomCode = room?.code ?? initialRoom.code;
  const jobs = useLiveTable<JobRow>({ table: "analysis_jobs", filter: { column: "room_id", value: roomId }, orderBy: { column: "created_at", ascending: false }, limit: 5 });

  const recordMetric = React.useCallback(
    (kind: "delivery_ms" | "realtime_connect_ms", value: number) => {
      const sb = getSupabase();
      if (!sb) return;
      void sb.from("metric_samples").insert({ session_id: me.session_id, room_id: roomId, kind, value_ms: Math.max(0, Math.round(value)) });
    },
    [roomId, me.session_id],
  );

  const messages = useLiveTable<LocalMessage>({
    table: "messages",
    filter: { column: "room_id", value: roomId },
    orderBy: { column: "seq", ascending: true },
    limit: 300,
    onInsert: (row) => {
      const started = pendingSends.current.get(row.client_msg_id);
      if (started !== undefined) {
        pendingSends.current.delete(row.client_msg_id);
        recordMetric("delivery_ms", performance.now() - started);
      }
    },
  });

  const presence = usePresence(`room:${roomId}`, { profileId: me.id, name: me.display_name, role: me.role }, (ms) => recordMetric("realtime_connect_ms", ms));

  // jogadores deste mundo (ordem de entrada: primeiro = A, segundo = B)
  const players = React.useMemo(() => {
    const byId = new Map(profiles.rows.map((p) => [p.id, p]));
    const list = members.rows.map((m) => byId.get(m.profile_id)).filter((p): p is ProfileRow => Boolean(p));
    if (!list.some((p) => p.id === me.id)) list.push(me);
    return list;
  }, [members.rows, profiles.rows, me]);

  // lista mesclada: remove otimistas já confirmadas (mesmo client_msg_id)
  const [optimistic, setOptimistic] = React.useState<LocalMessage[]>([]);
  const confirmedClientIds = React.useMemo(() => new Set(messages.rows.map((m) => m.client_msg_id)), [messages.rows]);
  const visible = React.useMemo(() => {
    const pending = optimistic.filter((o) => !confirmedClientIds.has(o.client_msg_id));
    return [...messages.rows.map((m) => ({ ...m, status: "sent" as const })), ...pending];
  }, [messages.rows, optimistic, confirmedClientIds]);

  React.useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible.length]);

  const nameOf = React.useCallback((profileId: string) => profiles.rows.find((p) => p.id === profileId) ?? null, [profiles.rows]);

  const analyzing = room?.analysis_pending || jobs.rows.some((j) => j.status === "running" && Date.now() - new Date(j.created_at).getTime() < 20000);
  const lastJob = jobs.rows[0] ?? null;

  async function send(existing?: LocalMessage) {
    const content = (existing?.content ?? draft).trim();
    if (!content) return;
    const clientMsgId = existing?.client_msg_id ?? uuid();
    const optimisticRow: LocalMessage = existing
      ? { ...existing, status: "sending", errorMessage: undefined }
      : { id: `local-${clientMsgId}`, room_id: roomId, sender_profile_id: me.id, seq: Number.MAX_SAFE_INTEGER, content, client_msg_id: clientMsgId, source: "human", created_at: new Date().toISOString(), status: "sending" };
    setOptimistic((prev) => [...prev.filter((o) => o.client_msg_id !== clientMsgId), optimisticRow]);
    if (!existing) setDraft("");
    setSendError(null);
    presence.sendTyping(false);
    pendingSends.current.set(clientMsgId, performance.now());
    try {
      await callFunction("send-message", { roomCode, content, clientMsgId, clientSentAt: new Date().toISOString() });
      setTimeout(() => {
        if (pendingSends.current.has(clientMsgId)) void messages.refetch();
      }, 4000);
    } catch (e) {
      pendingSends.current.delete(clientMsgId);
      const err = e instanceof ApiError ? e : null;
      const msg = err?.code === "rate_limited" ? "Muitas mensagens em pouco tempo. Aguarde alguns segundos." : err?.code === "room_contained" ? "Sala em contenção temporária. Aguarde a revisão humana." : (err?.message ?? "Falha ao enviar.");
      setSendError(msg);
      setOptimistic((prev) => prev.map((o) => (o.client_msg_id === clientMsgId ? { ...o, status: "failed", errorMessage: msg } : o)));
    }
  }

  // instante em que cada mensagem foi vista aqui (evita depender do relógio do servidor)
  const seenAt = React.useRef(new Map<string, number>());
  const primed = React.useRef(false);
  const gamePlayers: GamePlayer[] = React.useMemo(() => {
    const lastBySender = new Map<string, LocalMessage>();
    const firstBatch = !primed.current; // histórico carregado não vira balão
    if (messages.rows.length > 0) primed.current = true;
    for (const m of messages.rows) {
      if (!seenAt.current.has(m.id)) seenAt.current.set(m.id, firstBatch ? 0 : Date.now());
      lastBySender.set(m.sender_profile_id, m);
    }
    return players.slice(0, 2).map((p, i) => {
      const last = lastBySender.get(p.id);
      return {
        id: p.id,
        name: p.display_name,
        isMe: p.id === me.id,
        online: presence.members.some((mm) => mm.profileId === p.id),
        typing: presence.typing.includes(p.display_name),
        bubble: last ? { text: last.content, at: seenAt.current.get(last.id) ?? 0 } : null,
        slot: (i === 0 ? "A" : "B") as "A" | "B",
      };
    });
  }, [players, messages.rows, presence.members, presence.typing, me.id]);
  const level = room?.safety_level ?? "baixo";
  const online = presence.members.length;
  const disconnected = !messages.connected && !messages.loading;
  const [lite, setLite] = React.useState(false);
  React.useEffect(() => {
    setLite(window.innerWidth < 1024);
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-navy-950">
      <header className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-white/10 bg-navy-950/90 px-3 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Logo size={30} withWordmark={false} href="/lobby" />
          <div className="min-w-0">
            <div className="font-display truncate text-sm font-semibold leading-tight">{world.name}</div>
            <div className="truncate font-mono text-[10px] text-ink-400">mundo {world.code}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("chip", presence.connected ? "text-safe-300" : "text-warn-300")} title="Estado da conexão em tempo real">
            {presence.connected ? <RadioTower className="size-3.5" /> : <WifiOff className="size-3.5" />}
            <span className="hidden sm:inline">{presence.connected ? "tempo real" : "reconectando"}</span>
          </span>
          <span className="chip hidden sm:inline-flex">{me.display_name}</span>
          <Button variant="ghost" size="sm" onClick={() => void leave()} disabled={leaving} aria-label="Sair do mundo" data-testid="leave-world">
            <DoorOpen /> <span className="hidden sm:inline">{leaving ? "Saindo…" : "Sair do mundo"}</span>
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[36vh_1fr] lg:grid-cols-[1fr_400px] lg:grid-rows-1">
        {/* jogo (simulação) */}
        <div className="relative min-h-0 border-b border-white/10 lg:border-b-0 lg:border-r">
          <GameScene players={gamePlayers} roomName={world.name} lite={lite} />
        </div>

        {/* chat */}
        <div className="flex min-h-0 flex-col gap-2 bg-navy-950/80 p-2 sm:p-3">
          <div className="panel flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="font-display truncate text-sm font-semibold">Chat do mundo</div>
              <div className="truncate text-[11px] text-ink-300">Proteção contextual ativa · revisão humana</div>
            </div>
            <Badge title="Participantes online">
              <Users className="size-3.5" /> {online} {t("online")}
            </Badge>
          </div>

          <div className="flex flex-wrap gap-2 px-1" aria-label="Participantes">
            {players.map((p) => {
              const isOnline = presence.members.some((m) => m.profileId === p.id);
              return (
                <span key={p.id} className="chip">
                  <span className={cn("inline-block size-2 rounded-full", isOnline ? "bg-safe-400" : "bg-ink-500")} aria-hidden />
                  {p.display_name}
                  {p.id === me.id ? " (você)" : ""}
                </span>
              );
            })}
            {players.length < 2 ? <span className="chip text-ink-400">aguardando outro jogador…</span> : null}
          </div>

          <div ref={listRef} className="scrollbar-thin panel-strong min-h-0 flex-1 overflow-y-auto p-3" role="log" aria-live="polite" aria-label="Mensagens">
            {messages.loading ? <div className="text-center text-sm text-ink-400">Carregando conversa…</div> : null}
            {!messages.loading && visible.length === 0 ? <div className="py-10 text-center text-sm text-ink-400">Nenhuma mensagem ainda. Diga oi para o time.</div> : null}
            <ul className="flex flex-col gap-2">
              {visible.map((m) => {
                const mine = m.sender_profile_id === me.id;
                const sender = nameOf(m.sender_profile_id);
                return (
                  <li key={m.id} className={cn("animate-rise flex", mine ? "justify-end" : "justify-start")}>
                    <div className={cn("max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm", mine ? "rounded-br-md bg-navy-600 text-ink-50" : "rounded-bl-md bg-white/8 text-ink-50")}>
                      {!mine ? <div className="mb-0.5 text-[11px] font-semibold text-sky-400">{sender?.display_name ?? "…"}</div> : null}
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                      <div className={cn("mt-1 flex items-center gap-2 text-[10px]", mine ? "justify-end text-ink-200/80" : "text-ink-400")}>
                        <time dateTime={m.created_at}>{formatShortTime(m.created_at)}</time>
                        {mine ? <span>{m.status === "sending" ? "enviando…" : m.status === "failed" ? "falhou" : "entregue"}</span> : null}
                        {m.source === "script" ? <span className="text-ink-400">roteiro</span> : null}
                      </div>
                      {m.status === "failed" ? (
                        <button type="button" onClick={() => void send(m)} className="focus-ring mt-1 text-[11px] font-semibold text-warn-300 underline">
                          Tentar de novo
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="min-h-6 px-1 text-xs text-ink-300" aria-live="polite">
            {presence.typing.length > 0 ? (
              <span className="animate-pulse-soft">{presence.typing.join(", ")} {t("typing")}</span>
            ) : analyzing ? (
              <span className="inline-flex items-center gap-1.5 text-sky-400">
                <ShieldCheck className="size-3.5" /> {t("analyzing")}
              </span>
            ) : lastJob?.degraded ? (
              <span className="inline-flex items-center gap-1.5 text-warn-300">
                <AlertTriangle className="size-3.5" /> proteção em modo básico (regras)
              </span>
            ) : null}
          </div>

          {level !== "baixo" ? <SafetyNudge level={level} /> : null}
          {room?.contained ? (
            <div className="panel flex items-start gap-3 border-warn-500/40 bg-warn-500/10 px-4 py-3 text-sm text-warn-300" role="status">
              <Lock className="mt-0.5 size-4 shrink-0" />
              <div>
                <div className="font-semibold">Sala em contenção temporária de demonstração</div>
                <div className="text-xs text-warn-300/90">{room.contained_reason ?? "Um moderador humano pausou o envio de mensagens para revisão."}</div>
              </div>
            </div>
          ) : null}
          {disconnected ? (
            <div className="panel flex items-center gap-2 px-4 py-2 text-xs text-warn-300" role="status">
              <WifiOff className="size-4" /> Conexão em tempo real perdida. Reconectando e sincronizando…
            </div>
          ) : null}

          <form
            className="panel flex items-end gap-2 p-2"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="composer" className="sr-only">
              Mensagem
            </label>
            <textarea
              id="composer"
              value={draft}
              maxLength={500}
              rows={1}
              disabled={Boolean(room?.contained)}
              placeholder={room?.contained ? "Envio pausado pela revisão humana" : "Escreva uma mensagem…"}
              onChange={(e) => {
                setDraft(e.target.value);
                presence.sendTyping(e.target.value.length > 0);
              }}
              onBlur={() => presence.sendTyping(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              className="focus-ring max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-white/10 bg-navy-900/70 px-3 py-2.5 text-sm text-ink-50 placeholder:text-ink-400"
            />
            <Button type="submit" size="icon" aria-label={t("send")} disabled={!draft.trim() || Boolean(room?.contained)}>
              <SendHorizonal />
            </Button>
          </form>
          <div className="flex items-center justify-between px-1 text-[10px] text-ink-400">
            <span>{draft.length}/500</span>
            {sendError ? <span className="text-warn-300">{sendError}</span> : <span>{t("poc_banner")}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function SafetyNudge({ level }: { level: "atencao" | "alto" | "critico" }) {
  const text =
    level === "atencao"
      ? "Dica: se alguém pedir segredo, dados pessoais ou para conversar fora do jogo, tudo bem dizer não e falar com um adulto de confiança."
      : level === "alto"
        ? "Você está no controle: pode parar a conversa a qualquer momento. Um adulto de confiança já foi avisado para ajudar."
        : "Se algo aqui te deixou desconfortável, você não fez nada errado. Um adulto e a equipe de segurança estão acompanhando.";
  return (
    <div className={cn("panel animate-rise flex items-start gap-3 px-4 py-3 text-sm", level === "atencao" ? "border-sky-400/30" : "border-warn-500/40")} role="status">
      <ShieldCheck className="mt-0.5 size-4 shrink-0 text-sky-400" />
      <span className="text-ink-100">{text}</span>
    </div>
  );
}
