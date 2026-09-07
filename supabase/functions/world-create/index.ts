import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, randomCode, requireUser } from "../_shared/deno/supabase.ts";
import { findProfile, getGlobalSession } from "../_shared/deno/session.ts";

const Body = z.object({ name: z.string().min(2).max(40) });

/** Cria um mundo (sala) e coloca o criador dentro. */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));
    const session = await getGlobalSession(admin);
    const profile = await findProfile(admin, session.id, user.id, "player");
    if (!profile) throw new HttpError(403, "not_entered", "Entre no jogo antes de criar um mundo.");
    const name = body.name.replace(/\s+/g, " ").trim();

    // sai de mundos abertos anteriores (um jogador ocupa um mundo por vez)
    await leaveOpenWorlds(admin, profile.id);

    const { data: room, error: roomErr } = await admin.from("rooms").insert({ session_id: session.id, code: randomCode("R"), name }).select("id, code").single<{ id: string; code: string }>();
    if (roomErr || !room) throw new HttpError(500, "room_create_failed");
    const { data: world, error: worldErr } = await admin
      .from("worlds")
      .insert({ session_id: session.id, room_id: room.id, code: randomCode("W"), name, created_by_profile_id: profile.id })
      .select("id, code, name, status, room_id, scenario, script_cursor, max_players, created_at")
      .single();
    if (worldErr || !world) throw new HttpError(500, "world_create_failed");
    await admin.from("room_members").insert({ room_id: room.id, profile_id: profile.id });
    await admin.from("audit_events").insert({ session_id: session.id, room_id: room.id, event_type: "world.created", actor_type: "human", actor_profile_id: profile.id, payload: { world_code: world.code, name } });
    return json({ ok: true, world, room: { id: room.id, code: room.code, name } });
  }),
);

async function leaveOpenWorlds(admin: ReturnType<typeof adminClient>, profileId: string): Promise<void> {
  const { data } = await admin.from("room_members").select("room_id").eq("profile_id", profileId);
  const roomIds = (data ?? []).map((r) => r.room_id as string);
  if (roomIds.length === 0) return;
  const { data: open } = await admin.from("worlds").select("room_id").in("room_id", roomIds).eq("status", "open");
  const openRooms = (open ?? []).map((w) => w.room_id as string);
  if (openRooms.length > 0) await admin.from("room_members").delete().eq("profile_id", profileId).in("room_id", openRooms);
}
