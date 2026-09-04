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

const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX = 6;

Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));
    const content = body.content.replace(/\s+/g, " ").trim();
    if (!content) throw new HttpError(400, "empty_message");

    const { data: room } = await admin.from("rooms").select("id, session_id, contained").eq("code", body.roomCode).maybeSingle<{ id: string; session_id: string; contained: boolean }>();
    if (!room) throw new HttpError(404, "room_not_found");

    // perfil (persona) deste usuário na sala
    const { data: bindings } = await admin.from("profile_bindings").select("profile_id").eq("auth_user_id", user.id);
    const myProfiles = (bindings ?? []).map((b) => b.profile_id as string);
    if (myProfiles.length === 0) throw new HttpError(403, "not_a_member");
    const { data: membership } = await admin.from("room_members").select("profile_id").eq("room_id", room.id).in("profile_id", myProfiles).limit(1).maybeSingle<{ profile_id: string }>();
    if (!membership) throw new HttpError(403, "not_a_member");
    const profileId = membership.profile_id;

    if (room.contained) throw new HttpError(423, "room_contained", "Sala em contenção temporária de demonstração. Aguarde a revisão humana.");

    // rate limit simples por persona/sala
    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString();
    const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("room_id", room.id).eq("sender_profile_id", profileId).gte("created_at", since);
    if ((count ?? 0) >= RATE_LIMIT_MAX) throw new HttpError(429, "rate_limited", "Muitas mensagens em pouco tempo. Aguarde alguns segundos.");

    // persistência primeiro (idempotente por client_msg_id)
    const { data: inserted, error } = await admin
      .from("messages")
      .insert({ room_id: room.id, session_id: room.session_id, sender_profile_id: profileId, content, client_msg_id: body.clientMsgId, source: "human" })
      .select("id, seq, created_at")
      .maybeSingle<{ id: string; seq: number; created_at: string }>();

    let message = inserted;
    let duplicate = false;
    if (error || !message) {
      const { data: existing } = await admin
        .from("messages")
        .select("id, seq, created_at")
        .eq("room_id", room.id)
        .eq("sender_profile_id", profileId)
        .eq("client_msg_id", body.clientMsgId)
        .maybeSingle<{ id: string; seq: number; created_at: string }>();
      if (!existing) throw new HttpError(500, "insert_failed");
      message = existing;
      duplicate = true;
    }

    // análise assíncrona: a resposta não espera o motor
    if (!duplicate) background(runAnalysis(admin, { roomId: room.id, triggerType: "message", triggerMessageId: message.id }));

    return json({ ok: true, message: { id: message.id, seq: message.seq, createdAt: message.created_at }, duplicate });
  }),
);
