"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Loader2 } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import type { JoinState } from "@/lib/hooks/use-join";
import type { JoinResult } from "@/lib/types";

export function JoinGate({ state, roleLabel, children }: { state: JoinState; roleLabel: string; children: (data: JoinResult) => React.ReactNode }) {
  if (state.status === "ready") return <>{children(state.data)}</>;
  return (
    <AppShell role={roleLabel}>
      <div className="mx-auto mt-10 max-w-md">
        {state.status === "error" ? (
          <div className="panel-strong flex flex-col gap-4 p-6">
            <div className="flex items-center gap-2 text-warn-300">
              <AlertTriangle className="size-5" />
              <span className="font-display font-semibold">Não foi possível entrar</span>
            </div>
            <p className="text-sm text-ink-200">{state.message}</p>
            <p className="text-xs text-ink-400">Código: {state.code}</p>
            <Button asChild variant="secondary">
              <Link href="/demo">Ir para a Central da demonstração</Link>
            </Button>
          </div>
        ) : (
          <div className="panel-strong flex items-center gap-3 p-6 text-sm text-ink-200">
            <Loader2 className="size-5 animate-spin text-safe-400" /> Entrando como {roleLabel.toLowerCase()}…
          </div>
        )}
      </div>
    </AppShell>
  );
}
