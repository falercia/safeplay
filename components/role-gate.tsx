"use client";

import * as React from "react";
import { AlertTriangle, KeyRound, Loader2, UserRound } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardTitle } from "@/components/ui/card";
import { useRole } from "@/lib/hooks/use-role";
import type { RoleCreds, RoleKey } from "@/lib/session-store";
import type { RoleLoginResult } from "@/lib/types";

/**
 * Tela de código para moderação, responsável e apresentador. Quando autenticado, entrega o perfil
 * ao conteúdo. O código nunca é validado no cliente: vai para `role-login`.
 */
export function RoleGate({
  role,
  roleLabel,
  description,
  askName = false,
  children,
}: {
  role: RoleKey;
  roleLabel: string;
  description: string;
  askName?: boolean;
  children: (data: RoleLoginResult, logout: () => void, creds: RoleCreds) => React.ReactNode;
}) {
  const { state, login, logout } = useRole(role);
  const [code, setCode] = React.useState("");
  const [name, setName] = React.useState("");

  if (state.status === "ready") return <>{children(state.data, logout, state.creds)}</>;

  return (
    <AppShell role={roleLabel}>
      <Card strong className="mx-auto mt-10 max-w-md">
        {state.status === "loading" ? (
          <div className="flex items-center gap-3 text-sm text-ink-200">
            <Loader2 className="size-5 animate-spin text-safe-400" /> Entrando como {roleLabel.toLowerCase()}…
          </div>
        ) : state.status === "error" ? (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex items-center gap-2 text-warn-300">
              <AlertTriangle className="size-5" /> <span className="font-display font-semibold">Não foi possível entrar</span>
            </div>
            <p className="text-ink-200">{state.message}</p>
            <p className="text-xs text-ink-400">Código: {state.code}</p>
          </div>
        ) : (
          <>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="size-4" /> Acesso · {roleLabel}
            </CardTitle>
            <p className="mt-2 text-sm text-ink-300">{description}</p>
            <form
              className="mt-4 flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void login({ code, name: askName && name.trim() ? name.trim() : undefined });
              }}
            >
              {askName ? (
                <label className="flex flex-col gap-1.5 text-sm">
                  <span className="flex items-center gap-1.5 text-ink-200">
                    <UserRound className="size-4" /> Seu nome
                  </span>
                  <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="Ex.: Ana" autoComplete="nickname" data-testid="role-name" />
                </label>
              ) : null}
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="text-ink-200">Código de {roleLabel.toLowerCase()}</span>
                <Input type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" aria-label={`Código de ${roleLabel}`} autoComplete="off" required data-testid="role-code" />
              </label>
              {state.error ? (
                <p role="alert" className="text-xs text-warn-300">
                  {state.error.message}
                </p>
              ) : null}
              <Button type="submit" disabled={!code.trim()} data-testid="role-enter">
                Entrar
              </Button>
            </form>
          </>
        )}
      </Card>
    </AppShell>
  );
}
