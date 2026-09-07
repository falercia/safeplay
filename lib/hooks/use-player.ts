"use client";

import * as React from "react";
import { callFunction, ApiError } from "@/lib/api";
import { isConfigured } from "@/lib/env";
import { clearPlayer, loadPlayer, savePlayer, type PlayerCreds } from "@/lib/session-store";
import type { GameEnterResult } from "@/lib/types";

export type PlayerState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "ready"; data: GameEnterResult; creds: PlayerCreds }
  | { status: "error"; code: string; message: string };

export const ENTER_ERRORS: Record<string, string> = {
  invalid_code: "Código de acesso inválido. Confira com quem organizou a partida.",
  not_configured: "Aplicação sem configuração do Supabase. Veja o README.",
  auth_rate_limited: "Muitas entradas neste IP em pouco tempo. Aguarde alguns minutos.",
};

/** Chama `game-enter` com as credenciais e devolve o perfil do jogador. */
export async function enterGame(creds: PlayerCreds): Promise<GameEnterResult> {
  const data = await callFunction<GameEnterResult>("game-enter", { name: creds.name, accessCode: creds.accessCode });
  savePlayer({ name: data.profile.display_name, accessCode: creds.accessCode });
  return data;
}

export function friendlyError(e: unknown, extra: Record<string, string> = {}): { code: string; message: string } {
  const err = e instanceof ApiError ? e : new ApiError("unknown", e instanceof Error ? e.message : String(e), 0);
  return { code: err.code, message: extra[err.code] ?? ENTER_ERRORS[err.code] ?? err.message };
}

/**
 * Re-entra no jogo com as credenciais guardadas na aba (nome + código).
 * `anonymous` significa que a pessoa precisa passar pela tela /entrar.
 */
export function usePlayer(): PlayerState & { signOut: () => void } {
  const [state, setState] = React.useState<PlayerState>({ status: "loading" });

  React.useEffect(() => {
    let cancelled = false;
    if (!isConfigured()) {
      setState({ status: "error", code: "not_configured", message: ENTER_ERRORS["not_configured"]! });
      return;
    }
    const creds = loadPlayer();
    if (!creds) {
      setState({ status: "anonymous" });
      return;
    }
    enterGame(creds)
      .then((data) => {
        if (!cancelled) setState({ status: "ready", data, creds });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const f = friendlyError(e);
        if (f.code === "invalid_code") {
          clearPlayer();
          setState({ status: "anonymous" });
          return;
        }
        setState({ status: "error", ...f });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const signOut = React.useCallback(() => {
    clearPlayer();
    setState({ status: "anonymous" });
  }, []);

  return { ...state, signOut };
}
