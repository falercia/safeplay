import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, background, requireUser } from "../_shared/deno/supabase.ts";
import { runAnalysis } from "../_shared/deno/pipeline.ts";

const Body = z.object({
  roomCode: z.string().min(3).max(20),
  content: z.string().min(1).max(500),
  clientMsgId: z.string().min(1).max(64),
  /** tempo de envio no cliente (para métrica de latência de entrega) */
  clientSentAt: z.string().datetime().optional(),
});

const RATE_LIMIT_WINDOW_SECONDS = 10;
const RATE_LIMIT_MAX = 6;

interface SendResult {
  error?: string;
  duplicate?: boolean;
  id?: string;
  seq?: number;
  created_at?: string;
  room_id?: string;
}

/**
 * Persistência primeiro (uma única ida ao banco: membership, contenção, rate limit, idempotência, inserção),
 * transmissão via Realtime logo após, análise em segundo plano sem bloquear a resposta.
 */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));
    const content = body.content.replace(/\s+/g, " ").trim();
    if (!content) throw new HttpError(400, "empty_message");

    const { data, error } = await admin.rpc("admin_send_message", {
      p_room_code: body.roomCode,
      p_auth_user: user.id,
      p_content: content,
      p_client_msg_id: body.clientMsgId,
      p_rate_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
      p_rate_max: RATE_LIMIT_MAX,
    });
    if (error) throw new HttpError(500, "insert_failed");
    const result = data as SendResult;
    if (result.error === "room_not_found") throw new HttpError(404, "room_not_found");
    if (result.error === "not_a_member") throw new HttpError(403, "not_a_member");
    if (result.error === "room_contained") throw new HttpError(423, "room_contained", "Sala em contenção temporária de demonstração. Aguarde a revisão humana.");
    if (result.error === "rate_limited") throw new HttpError(429, "rate_limited", "Muitas mensagens em pouco tempo. Aguarde alguns segundos.");
    if (!result.id || !result.room_id) throw new HttpError(500, "insert_failed");

    // análise assíncrona: a resposta não espera o motor
    if (!result.duplicate) background(runAnalysis(admin, { roomId: result.room_id, triggerType: "message", triggerMessageId: result.id }));

    return json({ ok: true, message: { id: result.id, seq: result.seq, createdAt: result.created_at }, duplicate: Boolean(result.duplicate) });
  }),
);
