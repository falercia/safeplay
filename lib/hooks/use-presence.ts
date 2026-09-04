"use client";

import * as React from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";

export interface PresenceMember {
  profileId: string;
  name: string;
  role: string;
  onlineAt: string;
}

/** Presença online + indicador de digitação via Presence/Broadcast do Supabase Realtime. */
export function usePresence(roomKey: string | null, me: { profileId: string; name: string; role: string } | null, onConnect?: (ms: number) => void) {
  const [members, setMembers] = React.useState<PresenceMember[]>([]);
  const [typing, setTyping] = React.useState<Record<string, { name: string; until: number }>>({});
  const [connected, setConnected] = React.useState(false);
  const channelRef = React.useRef<RealtimeChannel | null>(null);
  const onConnectRef = React.useRef(onConnect);
  onConnectRef.current = onConnect;

  React.useEffect(() => {
    const sb = getSupabase();
    if (!sb || !roomKey || !me) return;
    const started = performance.now();
    const channel = sb.channel(`presence:${roomKey}`, { config: { presence: { key: me.profileId } } });
    channelRef.current = channel;
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState<PresenceMember>();
        const list: PresenceMember[] = [];
        for (const [, presences] of Object.entries(state)) {
          const p = presences[0];
          if (p) list.push({ profileId: p.profileId, name: p.name, role: p.role, onlineAt: p.onlineAt });
        }
        setMembers(list.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .on("broadcast", { event: "typing" }, ({ payload }) => {
        const p = payload as { profileId: string; name: string; typing: boolean };
        if (p.profileId === me.profileId) return;
        setTyping((prev) => {
          const next = { ...prev };
          if (p.typing) next[p.profileId] = { name: p.name, until: Date.now() + 3500 };
          else delete next[p.profileId];
          return next;
        });
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          setConnected(true);
          onConnectRef.current?.(Math.round(performance.now() - started));
          await channel.track({ profileId: me.profileId, name: me.name, role: me.role, onlineAt: new Date().toISOString() });
        } else if (status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          setConnected(false);
        }
      });
    return () => {
      channelRef.current = null;
      void sb.removeChannel(channel);
    };
  }, [roomKey, me?.profileId, me?.name, me?.role]); // eslint-disable-line react-hooks/exhaustive-deps

  // expira indicadores de digitação
  React.useEffect(() => {
    const id = setInterval(() => {
      setTyping((prev) => {
        const now = Date.now();
        const next = Object.fromEntries(Object.entries(prev).filter(([, v]) => v.until > now));
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  const lastSent = React.useRef(0);
  const sendTyping = React.useCallback(
    (isTyping: boolean) => {
      const ch = channelRef.current;
      if (!ch || !me) return;
      const now = Date.now();
      if (isTyping && now - lastSent.current < 1500) return;
      lastSent.current = now;
      void ch.send({ type: "broadcast", event: "typing", payload: { profileId: me.profileId, name: me.name, typing: isTyping } });
    },
    [me],
  );

  return { members, typing: Object.values(typing).map((t) => t.name), connected, sendTyping };
}
