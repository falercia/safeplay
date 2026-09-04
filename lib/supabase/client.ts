"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getPublicEnv } from "@/lib/env";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const env = getPublicEnv();
  if (!env) return null;
  client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: "safe-play-auth" },
    realtime: { params: { eventsPerSecond: 20 } },
  });
  return client;
}

/** Garante uma sessão anônima (Auth anônimo do Supabase). */
export class AuthSessionError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export async function ensureAnonSession(): Promise<{ userId: string; accessToken: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (data.session) return { userId: data.session.user.id, accessToken: data.session.access_token };
  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error || !anon.session) {
    const status = (error as { status?: number } | null)?.status;
    if (status === 429) throw new AuthSessionError("auth_rate_limited", "Limite de logins anônimos por hora atingido neste IP. Aguarde alguns minutos ou aumente o limite em Authentication → Rate Limits.");
    if (error?.message?.includes("anonymous_provider_disabled") || error?.message?.toLowerCase().includes("anonymous")) throw new AuthSessionError("anonymous_disabled", "Login anônimo desativado no Supabase (Authentication → Providers → Anonymous sign-ins).");
    throw new AuthSessionError("no_session", error?.message ?? "Não foi possível iniciar a sessão anônima");
  }
  return { userId: anon.session.user.id, accessToken: anon.session.access_token };
}
