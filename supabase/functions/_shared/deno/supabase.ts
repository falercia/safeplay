import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http.ts";

export type Admin = SupabaseClient;

export function adminClient(): Admin {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new HttpError(500, "missing_supabase_env");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export interface AuthUser {
  id: string;
  isAnonymous: boolean;
}

/** Valida o JWT do usuário (anônimo ou não) contra o Auth do Supabase. */
export async function requireUser(req: Request, admin: Admin): Promise<AuthUser> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "missing_token");
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "invalid_token");
  return { id: data.user.id, isAnonymous: Boolean(data.user.is_anonymous) };
}

export function requirePresenterSecret(req: Request): void {
  const expected = Deno.env.get("PRESENTER_SECRET");
  if (!expected) throw new HttpError(500, "presenter_secret_not_configured", "Defina PRESENTER_SECRET nos secrets das Edge Functions.");
  const given = req.headers.get("x-presenter-code") ?? "";
  if (!timingSafeEqual(given, expected)) throw new HttpError(403, "invalid_presenter_code");
}

function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function randomCode(prefix: string, len = 4): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `${prefix}-${out}`;
}

export function randomToken(bytes = 18): string {
  const arr = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...arr)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

declare global {
  // deno-lint-ignore no-var
  var EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
}

/** Executa trabalho em segundo plano sem bloquear a resposta (Supabase Edge Runtime). */
export function background(promise: Promise<unknown>): void {
  const rt = globalThis.EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(promise);
  else promise.catch((e) => console.error("background_error", e instanceof Error ? e.message.slice(0, 200) : "unknown"));
}
