"use client";

import * as React from "react";
import { AppShell } from "@/components/app-shell";
import { JoinGate } from "@/components/join-gate";
import { Card } from "@/components/ui/card";
import { TransparencyBody } from "@/components/safety/transparency";
import { useJoin } from "@/lib/hooks/use-join";
import { useRoomIntel } from "@/lib/hooks/use-room-intel";
import type { JoinResult } from "@/lib/types";
import { useT } from "@/lib/i18n";

/** Rota dedicada de transparência e auditoria. Aceita convite de responsável ou moderador. */
export function AuditPage({ token }: { roomCode: string; token: string | null }) {
  const join = useJoin(token);
  return (
    <JoinGate state={join} roleLabel="Auditoria">
      {(data) => <AuditInner data={data} />}
    </JoinGate>
  );
}

function AuditInner({ data }: { data: JoinResult }) {
  const { t } = useT();
  const intel = useRoomIntel(data.room?.id ?? null, data.profile.session_id);
  const [selected, setSelected] = React.useState<string | null>(null);
  const assessment = intel.assessments.find((a) => a.id === selected) ?? intel.latest;
  return (
    <AppShell role={`${t("transparency")} · ${data.profile.display_name}`}>
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <Card>
          <h2 className="font-display text-sm font-semibold uppercase tracking-wider text-ink-300">Avaliações</h2>
          <ul className="mt-2 flex max-h-[70vh] flex-col gap-1 overflow-y-auto text-xs">
            {intel.assessments
              .slice()
              .reverse()
              .map((a) => (
                <li key={a.id}>
                  <button type="button" onClick={() => setSelected(a.id)} className={`focus-ring w-full rounded-lg px-2 py-1.5 text-left ${assessment?.id === a.id ? "bg-white/10" : "hover:bg-white/5"}`}>
                    <span className="font-mono text-ink-400">{new Date(a.created_at).toLocaleTimeString("pt-BR")}</span> · score {a.score} · {a.level} · {a.method}
                    {a.degraded ? " · degradado" : ""}
                  </button>
                </li>
              ))}
            {intel.assessments.length === 0 ? <li className="text-ink-400">Nenhuma avaliação ainda.</li> : null}
          </ul>
        </Card>
        <Card>
          <TransparencyBody data={{ assessment, job: intel.jobs.find((j) => j.id === assessment?.job_id) ?? null, audit: intel.audit, kase: intel.activeCase, actions: intel.actions }} />
        </Card>
      </div>
    </AppShell>
  );
}
