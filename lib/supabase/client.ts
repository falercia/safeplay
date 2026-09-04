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
export async function ensureAnonSession(): Promise<{ userId: string; accessToken: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  if (data.session) return { userId: data.session.user.id, accessToken: data.session.access_token };
  const { data: anon, error } = await sb.auth.signInAnonymously();
  if (error || !anon.session) return null;
  return { userId: anon.session.user.id, accessToken: anon.session.access_token };
}
