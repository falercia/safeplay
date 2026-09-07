import { z } from "zod";
import { handle, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, requireUser } from "../_shared/deno/supabase.ts";
import { checkCode, findProfile, getGlobalSession, sanitizeName } from "../_shared/deno/session.ts";

const Body = z.object({ name: z.string().min(1).max(40), accessCode: z.string().min(1).max(40) });

/** Entrada no jogo: nome + código de acesso → perfil de jogador na sessão global. */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));
    checkCode(body.accessCode, "GAME_ACCESS_CODE");
    const name = sanitizeName(body.name);
    const session = await getGlobalSession(admin);

    let profile = await findProfile(admin, session.id, user.id, "player");
    if (profile) {
      if (profile.display_name !== name) {
        await admin.from("profiles").update({ display_name: name }).eq("id", profile.id);
        profile = { ...profile, display_name: name };
      }
    } else {
      const { data, error } = await admin
        .from("profiles")
        .insert({ session_id: session.id, role: "player", persona_key: "player", display_name: name, tagline: "Jogador", avatar: name.slice(0, 1).toUpperCase(), is_synthetic: false })
        .select("id, session_id, role, persona_key, display_name, tagline, avatar")
        .single();
      if (error || !data) throw new Error("profile_create_failed");
      profile = data;
      await admin.from("profile_bindings").insert({ profile_id: profile.id, auth_user_id: user.id });
      await admin.from("audit_events").insert({ session_id: session.id, event_type: "player.entered", actor_type: "human", actor_profile_id: profile.id, payload: {} });
    }

    // mundo atual (se já estiver em algum aberto)
    const { data: membership } = await admin.from("room_members").select("room_id").eq("profile_id", profile.id);
    const roomIds = (membership ?? []).map((m) => m.room_id as string);
    const { data: openWorlds } = roomIds.length ? await admin.from("worlds").select("code").in("room_id", roomIds).eq("status", "open").limit(1) : { data: [] };
    const current = openWorlds?.[0] ?? null;

    return json({ ok: true, profile, session: { id: session.id, code: session.code }, currentWorldCode: current?.code ?? null });
  }),
);
