"use client";

import * as React from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";

interface Options<T> {
  table: string;
  /** coluna e valor para filtro (ex.: room_id = uuid) */
  filter: { column: string; value: string } | null;
  select?: string;
  orderBy?: { column: string; ascending?: boolean };
  limit?: number;
  /** chave opcional cujo valor força um refetch (ex.: quando chegam novos sinais) */
  refetchKey?: string | number;
  enabled?: boolean;
  /** extra filtros PostgREST (aplicados apenas no fetch inicial) */
  extra?: (q: ReturnType<ReturnType<NonNullable<ReturnType<typeof getSupabase>>["from"]>["select"]>) => typeof q;
  onInsert?: (row: T) => void;
  onUpdate?: (row: T) => void;
}

export interface LiveTable<T> {
  rows: T[];
  loading: boolean;
  error: string | null;
  connected: boolean;
  refetch: () => Promise<void>;
  upsertLocal: (row: T) => void;
}

/**
 * Tabela "viva": carga inicial via PostgREST + assinatura Realtime (postgres_changes) com filtro,
 * mesclagem por id, refetch na reconexão (evita lacunas) e prevenção de duplicidade.
 */
export function useLiveTable<T extends { id: string | number }>(opts: Options<T>): LiveTable<T> {
  const { table, filter, select = "*", orderBy, limit, refetchKey, enabled = true } = opts;
  const [rows, setRows] = React.useState<T[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [connected, setConnected] = React.useState(false);
  const onInsertRef = React.useRef(opts.onInsert);
  const onUpdateRef = React.useRef(opts.onUpdate);
  onInsertRef.current = opts.onInsert;
  onUpdateRef.current = opts.onUpdate;
  const extraRef = React.useRef(opts.extra);
  extraRef.current = opts.extra;

  const sortRows = React.useCallback(
    (list: T[]) => {
      if (!orderBy) return list;
      const col = orderBy.column as keyof T;
      const asc = orderBy.ascending ?? true;
      return [...list].sort((a, b) => {
        const av = a[col] as unknown as string | number;
        const bv = b[col] as unknown as string | number;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      });
    },
    [orderBy],
  );

  const upsertLocal = React.useCallback(
    (row: T) => {
      setRows((prev) => {
        const idx = prev.findIndex((r) => r.id === row.id);
        const next = idx === -1 ? [...prev, row] : prev.map((r, i) => (i === idx ? { ...r, ...row } : r));
        return sortRows(next);
      });
    },
    [sortRows],
  );

  const refetch = React.useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !enabled) return;
    let q = sb.from(table).select(select);
    if (filter) q = q.eq(filter.column, filter.value);
    if (extraRef.current) q = extraRef.current(q as never) as typeof q;
    if (orderBy) q = q.order(orderBy.column, { ascending: orderBy.ascending ?? true });
    if (limit) q = q.limit(limit);
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
    } else {
      setError(null);
      setRows((prev) => {
        const map = new Map<string | number, T>();
        for (const r of prev) map.set(r.id, r);
        for (const r of (data ?? []) as unknown as T[]) map.set(r.id, { ...(map.get(r.id) ?? {}), ...r });
        return sortRows([...map.values()]);
      });
    }
    setLoading(false);
  }, [table, select, filter?.column, filter?.value, orderBy, limit, enabled, sortRows]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!enabled) return;
    void refetch();
  }, [refetch, refetchKey, enabled]);

  React.useEffect(() => {
    const sb = getSupabase();
    if (!sb || !enabled) return;
    const key = `live:${table}:${filter ? `${filter.column}=${filter.value}` : "all"}:${Math.random().toString(36).slice(2, 7)}`;
    const channel: RealtimeChannel = sb.channel(key);
    const cfg = { event: "*" as const, schema: "public", table, ...(filter ? { filter: `${filter.column}=eq.${filter.value}` } : {}) };
    channel.on("postgres_changes", cfg, (payload: RealtimePostgresChangesPayload<T>) => {
      if (payload.eventType === "INSERT") {
        const row = payload.new as T;
        upsertLocal(row);
        onInsertRef.current?.(row);
      } else if (payload.eventType === "UPDATE") {
        const row = payload.new as T;
        upsertLocal(row);
        onUpdateRef.current?.(row);
      } else if (payload.eventType === "DELETE") {
        const old = payload.old as Partial<T>;
        if (old.id !== undefined) setRows((prev) => prev.filter((r) => r.id !== old.id));
      }
    });
    let wasSubscribed = false;
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        setConnected(true);
        if (wasSubscribed) void refetch(); // reconexão: preenche lacunas
        wasSubscribed = true;
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        setConnected(false);
      }
    });
    return () => {
      void sb.removeChannel(channel);
    };
  }, [table, filter?.column, filter?.value, enabled, upsertLocal, refetch]); // eslint-disable-line react-hooks/exhaustive-deps

  return { rows, loading, error, connected, refetch, upsertLocal };
}
