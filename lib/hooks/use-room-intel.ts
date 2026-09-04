"use client";

import * as React from "react";
import { useLiveTable } from "@/lib/hooks/use-live-table";
import type { AlertRow, AssessmentRow, AuditRow, CaseActionRow, CaseRow, JobRow, MessageRow, ProfileRow, RoomRow, SignalRow } from "@/lib/types";

/**
 * Dados "vivos" de inteligência de uma sala: avaliações, sinais, alertas, casos, ações, auditoria, jobs.
 * A RLS decide o que cada papel enxerga; este hook só assina o que a política permite.
 */
export function useRoomIntel(roomId: string | null, sessionId: string | null) {
  const enabled = Boolean(roomId && sessionId);
  const filter = roomId ? { column: "room_id", value: roomId } : null;

  const room = useLiveTable<RoomRow>({ table: "rooms", filter: roomId ? { column: "id", value: roomId } : null, enabled });
  const profiles = useLiveTable<ProfileRow>({ table: "profiles", filter: sessionId ? { column: "session_id", value: sessionId } : null, enabled });
  const assessments = useLiveTable<AssessmentRow>({ table: "risk_assessments", filter, orderBy: { column: "created_at", ascending: true }, limit: 200, enabled });
  const alerts = useLiveTable<AlertRow>({ table: "alerts", filter, orderBy: { column: "created_at", ascending: false }, enabled });
  const cases = useLiveTable<CaseRow>({ table: "cases", filter, orderBy: { column: "created_at", ascending: false }, enabled });
  const jobs = useLiveTable<JobRow>({ table: "analysis_jobs", filter, orderBy: { column: "created_at", ascending: false }, limit: 20, enabled });
  const audit = useLiveTable<AuditRow>({ table: "audit_events", filter, orderBy: { column: "created_at", ascending: false }, limit: 200, enabled });

  const latest = assessments.rows[assessments.rows.length - 1] ?? null;
  const activeCase = cases.rows.find((c) => c.status === "open" || c.status === "in_review" || c.status === "needs_context") ?? cases.rows[0] ?? null;

  // ações do caso (sem filtro por room_id; filtra por case ids conhecidos)
  const caseIds = React.useMemo(() => cases.rows.map((c) => c.id).sort().join(","), [cases.rows]);
  const actions = useLiveTable<CaseActionRow>({
    table: "case_actions",
    filter: sessionId ? { column: "session_id", value: sessionId } : null,
    orderBy: { column: "created_at", ascending: true },
    enabled,
    refetchKey: caseIds,
  });

  // sinais mais recentes (para evidências); refetch quando chega avaliação nova
  const signals = useLiveTable<SignalRow>({ table: "risk_signals", filter, enabled, refetchKey: latest?.id ?? "none" });

  // mensagens visíveis para este papel (RLS: evidências para responsável; janela para moderador; tudo para apresentador)
  const messages = useLiveTable<MessageRow>({ table: "messages", filter, orderBy: { column: "seq", ascending: true }, limit: 300, enabled, refetchKey: `${latest?.id ?? ""}:${signals.rows.length}` });

  const connected = assessments.connected && alerts.connected && cases.connected;

  return { room: room.rows[0] ?? null, profiles: profiles.rows, assessments: assessments.rows, latest, alerts: alerts.rows, cases: cases.rows, activeCase, actions: actions.rows, signals: signals.rows, audit: audit.rows, jobs: jobs.rows, messages: messages.rows, connected, loading: assessments.loading };
}

export type RoomIntel = ReturnType<typeof useRoomIntel>;
