import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createSession, deleteSession } from "./helpers";

/** RLS contra o projeto real: jogador não lê fila de moderação nem altera avaliações. */
test("RLS: jogador não lê casos/avaliações nem escreve avaliações, alertas ou auditoria", async ({ page }) => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  test.skip(!url || !anon, "NEXT_PUBLIC_SUPABASE_URL/ANON_KEY não definidos no ambiente do Playwright");
  const links = await createSession(page, "progressivo");
  const token = new URL(links.playerA).searchParams.get("t")!;

  const sb = createClient(url!, anon!, { auth: { persistSession: false } });
  const { data: auth, error: authErr } = await sb.auth.signInAnonymously();
  expect(authErr).toBeNull();
  expect(auth.session).not.toBeNull();
  const { error: joinErr } = await sb.functions.invoke("join-room", { body: { token } });
  expect(joinErr).toBeNull();

  const cases = await sb.from("cases").select("id");
  expect(cases.data ?? []).toHaveLength(0);
  const assessments = await sb.from("risk_assessments").select("id");
  expect(assessments.data ?? []).toHaveLength(0);
  const invites = await sb.from("invites").select("id");
  expect(invites.error).not.toBeNull();

  const up = await sb.from("risk_assessments").update({ score: 0 }).neq("score", -1);
  expect(up.error).not.toBeNull();
  const ins = await sb.from("alerts").insert({ room_id: "00000000-0000-0000-0000-000000000000", session_id: "00000000-0000-0000-0000-000000000000", level: "alto", title: "x", summary: "x", recommendation: "revisar", dedupe_key: "x" });
  expect(ins.error).not.toBeNull();
  const audit = await sb.from("audit_events").insert({ session_id: "00000000-0000-0000-0000-000000000000", event_type: "x", actor_type: "human" });
  expect(audit.error).not.toBeNull();
  const msg = await sb.from("messages").insert({ room_id: "00000000-0000-0000-0000-000000000000", session_id: "00000000-0000-0000-0000-000000000000", sender_profile_id: "00000000-0000-0000-0000-000000000000", content: "x", client_msg_id: "x" });
  expect(msg.error).not.toBeNull();

  await deleteSession(page);
});
