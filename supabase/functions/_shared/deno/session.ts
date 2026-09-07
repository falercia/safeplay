import type { Admin } from "./supabase.ts";
import { HttpError } from "./http.ts";

export const GLOBAL_SESSION_CODE = "GLOBAL";

export interface GlobalSession {
  id: string;
  code: string;
  settings: Record<string, unknown>;
}

/** Sessão global da demo (criada pela migration; recriada aqui se faltar). */
export async function getGlobalSession(admin: Admin): Promise<GlobalSession> {
  const { data } = await admin.from("demo_sessions").select("id, code, settings").eq("code", GLOBAL_SESSION_CODE).maybeSingle<GlobalSession>();
  if (data) return data;
  const { data: created, error } = await admin.from("demo_sessions").insert({ code: GLOBAL_SESSION_CODE, scenario: "progressivo" }).select("id, code, settings").single<GlobalSession>();
  if (error || !created) throw new HttpError(500, "global_session_failed");
  return created;
}

export interface ProfileRow {
  id: string;
  session_id: string;
  role: "player" | "guardian" | "moderator" | "presenter";
  persona_key: string;
  display_name: string;
  tagline: string;
  avatar: string;
}

/** Perfil (por papel) vinculado ao usuário autenticado na sessão global. */
export async function findProfile(admin: Admin, sessionId: string, authUserId: string, role: ProfileRow["role"]): Promise<ProfileRow | null> {
  const { data: bindings } = await admin.from("profile_bindings").select("profile_id").eq("auth_user_id", authUserId);
  const ids = (bindings ?? []).map((b) => b.profile_id as string);
  if (ids.length === 0) return null;
  const { data } = await admin.from("profiles").select("id, session_id, role, persona_key, display_name, tagline, avatar").eq("session_id", sessionId).eq("role", role).in("id", ids).limit(1).maybeSingle<ProfileRow>();
  return data;
}

export function sanitizeName(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim().slice(0, 24);
  if (name.length < 2) throw new HttpError(400, "invalid_name", "Informe um nome com pelo menos 2 caracteres.");
  return name;
}

export function checkCode(given: string | undefined, envName: string): void {
  const expected = Deno.env.get(envName);
  if (!expected) throw new HttpError(500, "code_not_configured", `Defina ${envName} nos secrets das Edge Functions.`);
  const a = (given ?? "").trim().toUpperCase();
  const b = expected.trim().toUpperCase();
  if (a.length !== b.length || a.length === 0) throw new HttpError(403, "invalid_code", "Código inválido.");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  if (diff !== 0) throw new HttpError(403, "invalid_code", "Código inválido.");
}
