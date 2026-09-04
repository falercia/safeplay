"use client";

import { AuthSessionError, ensureAnonSession, getSupabase } from "@/lib/supabase/client";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) {
    super(message);
  }
}

/** Chama uma Edge Function com o JWT do usuário anônimo. */
export async function callFunction<T>(name: string, body: Record<string, unknown>, opts: { presenterCode?: string } = {}): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new ApiError("not_configured", "Supabase não configurado", 0);
  let session: Awaited<ReturnType<typeof ensureAnonSession>>;
  try {
    session = await ensureAnonSession();
  } catch (e) {
    if (e instanceof AuthSessionError) throw new ApiError(e.code, e.message, 0);
    throw e;
  }
  if (!session) throw new ApiError("no_session", "Não foi possível iniciar a sessão anônima", 0);
  const headers: Record<string, string> = {};
  if (opts.presenterCode) headers["x-presenter-code"] = opts.presenterCode;
  const { data, error } = await sb.functions.invoke<T & { ok?: boolean; error?: string; message?: string }>(name, { body, headers });
  if (error) {
    // supabase-js embute a resposta em error.context (Response)
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      try {
        const payload = (await ctx.json()) as { error?: string; message?: string };
        throw new ApiError(payload.error ?? "request_failed", payload.message ?? payload.error ?? error.message, ctx.status);
      } catch (e) {
        if (e instanceof ApiError) throw e;
      }
    }
    throw new ApiError("request_failed", error.message, 0);
  }
  if (!data) throw new ApiError("empty_response", "Resposta vazia", 0);
  if (data.ok === false) throw new ApiError(data.error ?? "request_failed", data.message ?? "Falha", 400);
  return data;
}
