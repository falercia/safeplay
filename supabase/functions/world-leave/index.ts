import { handle, HttpError, json } from "../_shared/deno/http.ts";
import { adminClient, requireUser } from "../_shared/deno/supabase.ts";
import { findProfile, getGlobalSession } from "../_shared/deno/session.ts";

/** Sai de todos os mundos abertos em que o jogador está (o mundo continua existindo para quem ficou). */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const session = await getGlobalSession(admin);
    const profile = await findProfile(admin, session.id, user.id, "player");
    if (!profile) throw new HttpError(403, "not_entered", "Entre no jogo antes.");
    const { data } = await admin.from("room_members").select("room_id").eq("profile_id", profile.id);
    const roomIds = (data ?? []).map((r) => r.room_id as string);
    let left = 0;
    if (roomIds.length > 0) {
      const { data: open } = await admin.from("worlds").select("room_id, code").in("room_id", roomIds).eq("status", "open");
      const openRooms = (open ?? []).map((w) => w.room_id as string);
      if (openRooms.length > 0) {
        await admin.from("room_members").delete().eq("profile_id", profile.id).in("room_id", openRooms);
        for (const w of open ?? []) {
          await admin.from("audit_events").insert({ session_id: session.id, room_id: w.room_id as string, event_type: "world.left", actor_type: "human", actor_profile_id: profile.id, payload: { world_code: w.code } });
        }
        left = openRooms.length;
      }
    }
    return json({ ok: true, left });
  }),
);
