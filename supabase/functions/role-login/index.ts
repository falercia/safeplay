import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, requireUser } from "../_shared/deno/supabase.ts";
import { checkCode, findProfile, getGlobalSession, sanitizeName } from "../_shared/deno/session.ts";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), role: z.enum(["moderator", "guardian", "presenter"]), code: z.string().min(1).max(64), name: z.string().min(1).max(40).optional() }),
  z.object({ action: z.literal("watch"), worldCode: z.string().min(3).max(20) }),
]);

const CODE_ENV: Record<string, string> = { moderator: "MODERATOR_CODE", guardian: "GUARDIAN_CODE", presenter: "PRESENTER_SECRET" };
const LABEL: Record<string, string> = { moderator: "Moderação", guardian: "Responsável", presenter: "Apresentador" };

/** Login por código para papéis (moderação, responsável, apresentador) e vínculo do responsável a um mundo. */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));
    const session = await getGlobalSession(admin);

    if (body.action === "login") {
      checkCode(body.code, CODE_ENV[body.role]!);
      const name = body.name ? sanitizeName(body.name) : LABEL[body.role]!;
      let profile = await findProfile(admin, session.id, user.id, body.role);
      if (!profile) {
        const { data, error } = await admin
          .from("profiles")
          .insert({ session_id: session.id, role: body.role, persona_key: body.role, display_name: name, tagline: LABEL[body.role], avatar: name.slice(0, 1).toUpperCase(), is_synthetic: false })
          .select("id, session_id, role, persona_key, display_name, tagline, avatar")
          .single();
        if (error || !data) throw new HttpError(500, "profile_create_failed");
        profile = data;
        await admin.from("profile_bindings").insert({ profile_id: profile.id, auth_user_id: user.id });
        if (body.role === "presenter") await admin.from("demo_sessions").update({ presenter_auth_user_id: user.id }).eq("id", session.id);
        await admin.from("audit_events").insert({ session_id: session.id, event_type: `${body.role}.logged_in`, actor_type: body.role === "presenter" ? "presenter" : "human", actor_profile_id: profile.id, payload: {} });
      }
      return json({ ok: true, profile, session: { id: session.id, code: session.code } });
    }

    // watch: responsável passa a acompanhar um mundo (vínculo com quem criou o mundo, a "criança" da demo)
    const guardian = await findProfile(admin, session.id, user.id, "guardian");
    if (!guardian) throw new HttpError(403, "not_a_guardian");
    const { data: world } = await admin.from("worlds").select("id, code, name, room_id, created_by_profile_id").eq("code", body.worldCode.toUpperCase()).maybeSingle<{ id: string; code: string; name: string; room_id: string; created_by_profile_id: string | null }>();
    if (!world) throw new HttpError(404, "world_not_found");
    const ward = world.created_by_profile_id ?? guardian.id;
    await admin.from("guardian_links").upsert({ guardian_profile_id: guardian.id, ward_profile_id: ward, room_id: world.room_id }, { onConflict: "guardian_profile_id,room_id", ignoreDuplicates: true });
    await admin.from("audit_events").insert({ session_id: session.id, room_id: world.room_id, event_type: "guardian.watching", actor_type: "human", actor_profile_id: guardian.id, payload: { world_code: world.code } });
    return json({ ok: true, world: { id: world.id, code: world.code, name: world.name, room_id: world.room_id } });
  }),
);
