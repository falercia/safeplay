"use client";

import * as React from "react";
import { callFunction } from "@/lib/api";
import { isConfigured } from "@/lib/env";
import { clearRole, loadRole, saveRole, type RoleCreds, type RoleKey } from "@/lib/session-store";
import type { RoleLoginResult } from "@/lib/types";
import { ENTER_ERRORS, friendlyError } from "@/lib/hooks/use-player";

export type RoleState =
  | { status: "loading" }
  | { status: "anonymous"; error?: { code: string; message: string } }
  | { status: "ready"; data: RoleLoginResult; creds: RoleCreds }
  | { status: "error"; code: string; message: string };

/**
 * Login por código para moderação, responsável e apresentador. Guarda o código na aba
 * e re-autentica no refresh. O servidor valida o código (role-login) e cria/reencontra o perfil.
 */
export function useRole(role: RoleKey) {
  const [state, setState] = React.useState<RoleState>({ status: "loading" });

  const login = React.useCallback(
    async (creds: RoleCreds): Promise<boolean> => {
      setState({ status: "loading" });
      try {
        const data = await callFunction<RoleLoginResult>("role-login", { action: "login", role, code: creds.code.trim(), ...(creds.name ? { name: creds.name } : {}) });
        saveRole(role, { code: creds.code.trim(), name: data.profile.display_name });
        setState({ status: "ready", data, creds: { code: creds.code.trim(), name: data.profile.display_name } });
        return true;
      } catch (e) {
        const f = friendlyError(e, { invalid_code: "Código inválido para este papel." });
        if (f.code === "invalid_code") clearRole(role);
        setState(f.code === "invalid_code" ? { status: "anonymous", error: f } : { status: "error", ...f });
        return false;
      }
    },
    [role],
  );

  React.useEffect(() => {
    if (!isConfigured()) {
      setState({ status: "error", code: "not_configured", message: ENTER_ERRORS["not_configured"]! });
      return;
    }
    const creds = loadRole(role);
    if (!creds) {
      setState({ status: "anonymous" });
      return;
    }
    void login(creds);
  }, [role, login]);

  const logout = React.useCallback(() => {
    clearRole(role);
    setState({ status: "anonymous" });
  }, [role]);

  return { state, login, logout };
}
