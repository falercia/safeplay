"use client";

/**
 * Identidade local (por aba) de quem usa o app: nome + código de acesso do jogador e códigos por papel.
 * O vínculo real com o perfil fica no servidor (auth anônimo + profile_bindings); aqui só guardamos
 * o que é preciso para re-entrar automaticamente após um refresh.
 */

const PLAYER_KEY = "safe-play:player";
const ROLE_PREFIX = "safe-play:role:";

export interface PlayerCreds {
  name: string;
  accessCode: string;
}

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadPlayer(): PlayerCreds | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(PLAYER_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<PlayerCreds>;
    if (typeof v.name !== "string" || typeof v.accessCode !== "string") return null;
    return { name: v.name, accessCode: v.accessCode };
  } catch {
    return null;
  }
}

export function savePlayer(p: PlayerCreds): void {
  storage()?.setItem(PLAYER_KEY, JSON.stringify(p));
}

export function clearPlayer(): void {
  storage()?.removeItem(PLAYER_KEY);
}

export type RoleKey = "moderator" | "guardian" | "presenter";

export interface RoleCreds {
  code: string;
  name?: string;
}

export function loadRole(role: RoleKey): RoleCreds | null {
  const s = storage();
  if (!s) return null;
  try {
    const raw = s.getItem(ROLE_PREFIX + role);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RoleCreds>;
    return typeof v.code === "string" ? { code: v.code, name: typeof v.name === "string" ? v.name : undefined } : null;
  } catch {
    return null;
  }
}

export function saveRole(role: RoleKey, creds: RoleCreds): void {
  storage()?.setItem(ROLE_PREFIX + role, JSON.stringify(creds));
}

export function clearRole(role: RoleKey): void {
  storage()?.removeItem(ROLE_PREFIX + role);
}
