import { z } from "zod";

const PublicEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20),
  NEXT_PUBLIC_APP_ENV: z.string().default("demo"),
});

export type PublicEnv = z.infer<typeof PublicEnv>;

let cached: PublicEnv | null | undefined;

/** Variáveis públicas validadas com Zod. Retorna null quando o app ainda não foi configurado. */
export function getPublicEnv(): PublicEnv | null {
  if (cached !== undefined) return cached;
  const parsed = PublicEnv.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  });
  cached = parsed.success ? parsed.data : null;
  return cached;
}

export function isConfigured(): boolean {
  return getPublicEnv() !== null;
}
