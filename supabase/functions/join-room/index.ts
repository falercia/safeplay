import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, requireUser } from "../_shared/deno/supabase.ts";

const Body = z.object({ token: z.string().min(8).max(64) });

/**
 * Resgata um convite por papel e vincula o usuário anônimo à persona correspondente.
 * Convites são validados server-side; o cliente nunca lê a tabela de convites.
 */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const { token } = Body.parse(await readJson(req));

    const { data: invite } = await admin
      .from("invites")
      .select("id, session_id, room_id, profile_id, role, uses, max_uses, expires_at")
      .eq("token", token)
      .maybeSingle<{ id: string; session_id: string; room_id: string | null; profile_id: string; role: string; uses: number; max_uses: number; expires_at: string }>();
    if (!invite) throw new HttpError(404, "invite_not_found");
    if (new Date(invite.expires_at) < new Date()) throw new HttpError(410, "invite_expired");

    const { data: bound } = await admin.from("profile_bindings").select("profile_id").eq("profile_id", invite.profile_id).eq("auth_user_id", user.id).maybeSingle();
    if (!bound) {
      if (invite.uses >= invite.max_uses) throw new HttpError(410, "invite_exhausted");
      await admin.from("profile_bindings").insert({ profile_id: invite.profile_id, auth_user_id: user.id });
      await admin.from("invites").update({ uses: invite.uses + 1 }).eq("id", invite.id);
      await admin.from("audit_events").insert({
        session_id: invite.session_id,
        room_id: invite.room_id,
        event_type: "invite.claimed",
        actor_type: "human",
        actor_profile_id: invite.profile_id,
        payload: { role: invite.role, anonymous: user.isAnonymous },
      });
    }

    const { data: profile } = await admin.from("profiles").select("id, session_id, role, persona_key, display_name, tagline, avatar").eq("id", invite.profile_id).single();
    const { data: session } = await admin.from("demo_sessions").select("id, code, scenario").eq("id", invite.session_id).single();
    const room = invite.room_id ? (await admin.from("rooms").select("id, code, name").eq("id", invite.room_id).single()).data : null;

    return json({ ok: true, profile, session, room });
  }),
);
