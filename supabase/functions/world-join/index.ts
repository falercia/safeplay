import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, requireUser } from "../_shared/deno/supabase.ts";
import { findProfile, getGlobalSession } from "../_shared/deno/session.ts";

const Body = z.object({ worldCode: z.string().min(3).max(20) });

/** Entra em um mundo aberto (até max_players). Idempotente para quem já está dentro. */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));
    const session = await getGlobalSession(admin);
    const profile = await findProfile(admin, session.id, user.id, "player");
    if (!profile) throw new HttpError(403, "not_entered", "Entre no jogo antes de escolher um mundo.");

    const { data: world } = await admin
      .from("worlds")
      .select("id, code, name, status, room_id, scenario, script_cursor, max_players, created_at")
      .eq("code", body.worldCode.toUpperCase())
      .maybeSingle<{ id: string; code: string; name: string; status: string; room_id: string; scenario: string; script_cursor: number; max_players: number; created_at: string }>();
    if (!world) throw new HttpError(404, "world_not_found", "Mundo não encontrado.");
    if (world.status !== "open") throw new HttpError(410, "world_closed", "Este mundo foi encerrado.");

    const { data: existing } = await admin.from("room_members").select("profile_id").eq("room_id", world.room_id).eq("profile_id", profile.id).maybeSingle();
    if (!existing) {
      const { count } = await admin.from("room_members").select("profile_id", { count: "exact", head: true }).eq("room_id", world.room_id);
      if ((count ?? 0) >= world.max_players) throw new HttpError(409, "world_full", "Este mundo está cheio.");
      // sai de outros mundos abertos
      const { data: mine } = await admin.from("room_members").select("room_id").eq("profile_id", profile.id);
      const otherRooms = (mine ?? []).map((r) => r.room_id as string).filter((r) => r !== world.room_id);
      if (otherRooms.length > 0) {
        const { data: open } = await admin.from("worlds").select("room_id").in("room_id", otherRooms).eq("status", "open");
        const openRooms = (open ?? []).map((w) => w.room_id as string);
        if (openRooms.length > 0) await admin.from("room_members").delete().eq("profile_id", profile.id).in("room_id", openRooms);
      }
      await admin.from("room_members").insert({ room_id: world.room_id, profile_id: profile.id });
      await admin.from("audit_events").insert({ session_id: session.id, room_id: world.room_id, event_type: "world.joined", actor_type: "human", actor_profile_id: profile.id, payload: { world_code: world.code } });
    }
    const { data: room } = await admin.from("rooms").select("code").eq("id", world.room_id).single<{ code: string }>();
    return json({ ok: true, world, room: { id: world.room_id, code: room?.code ?? "", name: world.name } });
  }),
);
