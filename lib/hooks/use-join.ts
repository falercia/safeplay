"use client";

import * as React from "react";
import { callFunction, ApiError } from "@/lib/api";
import { isConfigured } from "@/lib/env";
import type { JoinResult } from "@/lib/types";

export type JoinState =
  | { status: "idle" | "joining" }
  | { status: "ready"; data: JoinResult }
  | { status: "error"; code: string; message: string };

/** Resgata o convite (token) e vincula o usuário anônimo à persona do papel. */
export function useJoin(token: string | null, expectedRole?: "player" | "guardian" | "moderator") {
  const [state, setState] = React.useState<JoinState>({ status: "idle" });

  React.useEffect(() => {
    let cancelled = false;
    if (!isConfigured()) {
      setState({ status: "error", code: "not_configured", message: "Aplicação sem configuração do Supabase. Veja o README." });
      return;
    }
    if (!token) {
      setState({ status: "error", code: "missing_token", message: "Este link não contém um convite válido. Gere os links na Central da demonstração." });
      return;
    }
    setState({ status: "joining" });
    callFunction<JoinResult>("join-room", { token })
      .then((data) => {
        if (cancelled) return;
        if (expectedRole && data.profile.role !== expectedRole) {
          setState({ status: "error", code: "wrong_role", message: `Este convite é do papel "${data.profile.role}", não "${expectedRole}".` });
          return;
        }
        setState({ status: "ready", data });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const err = e instanceof ApiError ? e : new ApiError("unknown", String(e), 0);
        const friendly: Record<string, string> = {
          invite_not_found: "Convite não encontrado. A sessão pode ter sido apagada.",
          invite_expired: "Convite expirado. Crie uma nova sessão.",
          invite_exhausted: "Convite já usado o número máximo de vezes.",
        };
        setState({ status: "error", code: err.code, message: friendly[err.code] ?? err.message });
      });
    return () => {
      cancelled = true;
    };
  }, [token, expectedRole]);

  return state;
}
