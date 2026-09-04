export const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-presenter-code",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS_HEADERS, ...extra },
  });
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export function fail(status: number, code: string, message?: string): Response {
  return json({ ok: false, error: code, message: message ?? code }, status);
}

export async function readJson<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "invalid_json");
  }
}

export function handle(fn: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
    if (req.method !== "POST") return fail(405, "method_not_allowed");
    try {
      return await fn(req);
    } catch (e) {
      if (e instanceof HttpError) return fail(e.status, e.code, e.message);
      // nunca registrar conteúdo de mensagens; apenas o tipo do erro
      console.error("unhandled_error", e instanceof Error ? e.name + ": " + e.message.slice(0, 200) : "unknown");
      return fail(500, "internal_error");
    }
  };
}
