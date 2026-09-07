"use client";

import * as React from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";

interface Options<T> {
  table: string;
  /** origem do fetch quando diferente da tabela assinada (ex.: uma view sobre a tabela) */
  source?: string;
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
  /** chave de identidade quando a tabela não tem coluna `id` (ex.: chaves compostas) */
  rowKey?: (row: T) => string;
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
export function useLiveTable<T extends object>(opts: Options<T>): LiveTable<T> {
  const { table, source, filter, select = "*", orderBy, limit, refetchKey, enabled = true } = opts;
  const from = source ?? table;
  // primitivas estáveis para dependências (evita re-assinaturas a cada render)
  const filterCol = filter?.column ?? null;
  const filterVal = filter?.value ?? null;
  const orderCol = orderBy?.column ?? null;
  const orderAsc = orderBy?.ascending ?? true;
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
  const rowKeyRef = React.useRef(opts.rowKey);
  rowKeyRef.current = opts.rowKey;
  const keyOf = React.useCallback((r: Partial<T>): string => (rowKeyRef.current ? rowKeyRef.current(r as T) : String((r as { id?: string | number }).id)), []);

  const sortRows = React.useCallback(
    (list: T[]) => {
      if (!orderCol) return list;
      const col = orderCol as keyof T;
      return [...list].sort((a, b) => {
        const av = a[col] as unknown as string | number;
        const bv = b[col] as unknown as string | number;
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (orderAsc ? 1 : -1);
      });
    },
    [orderCol, orderAsc],
  );

  const upsertLocal = React.useCallback(
    (row: T) => {
      setRows((prev) => {
        const idx = prev.findIndex((r) => keyOf(r) === keyOf(row));
        const next = idx === -1 ? [...prev, row] : prev.map((r, i) => (i === idx ? { ...r, ...row } : r));
        return sortRows(next);
      });
    },
    [sortRows, keyOf],
  );

  const refetch = React.useCallback(async () => {
    const sb = getSupabase();
    if (!sb || !enabled) return;
    let q = sb.from(from).select(select);
    if (filterCol && filterVal) q = q.eq(filterCol, filterVal);
    if (extraRef.current) q = extraRef.current(q as never) as typeof q;
    if (orderCol) q = q.order(orderCol, { ascending: orderAsc });
    if (limit) q = q.limit(limit);
    const { data, error: err } = await q;
    if (err) {
      setError(err.message);
    } else {
      setError(null);
      // a consulta completa é a verdade: linhas ausentes foram apagadas (eventos DELETE filtrados
      // por coluna não chegam, pois o registro antigo só traz a chave primária)
      setRows((prev) => {
        const before = new Map<string, T>();
        for (const r of prev) before.set(keyOf(r), r);
        return sortRows(((data ?? []) as unknown as T[]).map((r) => ({ ...(before.get(keyOf(r)) ?? {}), ...r })));
      });
    }
    setLoading(false);
  }, [from, select, filterCol, filterVal, orderCol, orderAsc, limit, enabled, sortRows, keyOf]);

  React.useEffect(() => {
    if (!enabled) return;
    void refetch();
  }, [refetch, refetchKey, enabled]);

  // ao voltar o foco/aba, sincroniza (cobre exclusões feitas enquanto a aba estava em segundo plano)
  React.useEffect(() => {
    if (!enabled) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refetch, enabled]);

  React.useEffect(() => {
    const sb = getSupabase();
    if (!sb || !enabled) return;
    const key = `live:${table}:${filterCol ? `${filterCol}=${filterVal}` : "all"}:${Math.random().toString(36).slice(2, 7)}`;
    const channel: RealtimeChannel = sb.channel(key);
    const cfg = { event: "*" as const, schema: "public", table, ...(filterCol && filterVal ? { filter: `${filterCol}=eq.${filterVal}` } : {}) };
    channel.on("postgres_changes", cfg, (payload: RealtimePostgresChangesPayload<T>) => {
      if (source) {
        // view: a linha do evento não traz as colunas derivadas; recarrega
        void refetch();
        return;
      }
      if (payload.eventType === "INSERT") {
        const row = payload.new as T;
        upsertLocal(row);
        onInsertRef.current?.(row);
      } else if (payload.eventType === "UPDATE") {
        const row = payload.new as T;
        upsertLocal(row);
        onUpdateRef.current?.(row);
      } else if (payload.eventType === "DELETE") {
        const old = payload.old as Partial<T> & { id?: string | number };
        if (rowKeyRef.current) {
          const fn = rowKeyRef.current;
          setRows((prev) => prev.filter((r) => keyOf(r) !== fn(old as T)));
        } else if (old.id !== undefined) {
          const k = String(old.id);
          setRows((prev) => prev.filter((r) => keyOf(r) !== k));
        }
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
  }, [table, source, filterCol, filterVal, enabled, upsertLocal, refetch, keyOf]);

  return { rows, loading, error, connected, refetch, upsertLocal };
}
