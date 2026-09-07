import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, requirePresenterSecret, requireUser, type Admin } from "../_shared/deno/supabase.ts";
import { findProfile, getGlobalSession, type GlobalSession } from "../_shared/deno/session.ts";
import { runAnalysis } from "../_shared/deno/pipeline.ts";
import { claudeConfigFromEnv } from "../_shared/deno/claude.ts";
import { RULES_VERSION, SCENARIOS, type ScenarioKey } from "../_shared/risk/index.ts";

const ScenarioSchema = z.enum(["saudavel", "progressivo", "falso_positivo"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("list_worlds") }),
  z.object({ action: z.literal("status"), worldCode: z.string() }),
  z.object({ action: z.literal("advance"), worldCode: z.string() }),
  z.object({ action: z.literal("set_scenario"), worldCode: z.string(), scenario: ScenarioSchema }),
  z.object({ action: z.literal("reset_world"), worldCode: z.string() }),
  z.object({ action: z.literal("close_world"), worldCode: z.string() }),
  z.object({ action: z.literal("delete_world"), worldCode: z.string() }),
  z.object({ action: z.literal("purge_closed") }),
  z.object({ action: z.literal("set_setting"), key: z.enum(["llm_disabled", "force_llm_failure"]), value: z.boolean() }),
]);

interface WorldRow {
  id: string;
  code: string;
  name: string;
  status: string;
  room_id: string;
  scenario: ScenarioKey;
  script_cursor: number;
  created_by_profile_id: string | null;
  created_at: string;
}

/** Central do apresentador (v2): opera sobre mundos da sessão global. Protegida por PRESENTER_SECRET. */
Deno.serve(
  handle(async (req) => {
    requirePresenterSecret(req);
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));
    const session = await getGlobalSession(admin);
    await ensurePresenter(admin, session.id, user.id);

    if (body.action === "list_worlds") {
      const { data } = await admin.from("world_lobby").select("*").eq("session_id", session.id).order("created_at", { ascending: false }).limit(30);
      const { data: rooms } = await admin.from("rooms").select("id, safety_level, safety_score, contained, analysis_pending").eq("session_id", session.id);
      const byRoom = new Map((rooms ?? []).map((r) => [r.id as string, r]));
      return json({ ok: true, worlds: (data ?? []).map((w) => ({ ...w, room: byRoom.get(w.room_id as string) ?? null })), health: await health(admin, session) });
    }
    if (body.action === "purge_closed") {
      const { data: n } = await admin.rpc("admin_purge_closed_worlds");
      await admin.from("audit_events").insert({ session_id: session.id, event_type: "worlds.purged", actor_type: "presenter", payload: { count: n ?? 0 } });
      return json({ ok: true, purged: n ?? 0 });
    }
    if (body.action === "set_setting") {
      const settings = { ...(session.settings ?? {}), [body.key]: body.value };
      await admin.from("demo_sessions").update({ settings }).eq("id", session.id);
      await admin.from("audit_events").insert({ session_id: session.id, event_type: "session.setting_changed", actor_type: "presenter", payload: { key: body.key, value: body.value } });
      return json({ ok: true, health: await health(admin, { ...session, settings }) });
    }

    const world = await loadWorld(admin, body.worldCode);
    switch (body.action) {
      case "status":
        return json({ ok: true, status: await buildStatus(admin, session, world) });
      case "reset_world": {
        await admin.rpc("admin_reset_world", { p_world: world.id });
        await admin.from("audit_events").insert({ session_id: session.id, room_id: world.room_id, event_type: "world.reset", actor_type: "presenter", payload: { world_code: world.code } });
        return json({ ok: true, status: await buildStatus(admin, session, await loadWorld(admin, world.code)) });
      }
      case "delete_world": {
        await admin.from("audit_events").insert({ session_id: session.id, event_type: "world.deleted", actor_type: "presenter", payload: { world_code: world.code, name: world.name } });
        await admin.rpc("admin_delete_world", { p_world: world.id });
        return json({ ok: true });
      }
      case "close_world": {
        await admin.from("worlds").update({ status: "closed", closed_at: new Date().toISOString() }).eq("id", world.id);
        await admin.from("audit_events").insert({ session_id: session.id, room_id: world.room_id, event_type: "world.closed", actor_type: "presenter", payload: { world_code: world.code } });
        return json({ ok: true });
      }
      case "set_scenario": {
        await admin.from("worlds").update({ scenario: body.scenario, script_cursor: 0 }).eq("id", world.id);
        await admin.from("audit_events").insert({ session_id: session.id, room_id: world.room_id, event_type: "world.scenario_changed", actor_type: "presenter", payload: { scenario: body.scenario } });
        return json({ ok: true, status: await buildStatus(admin, session, await loadWorld(admin, world.code)) });
      }
      case "advance": {
        const scenario = SCENARIOS[world.scenario];
        const line = scenario.script[world.script_cursor];
        if (!line) return json({ ok: true, done: true, status: await buildStatus(admin, session, world) });
        const speakers = await worldSpeakers(admin, world);
        const speaker = line.speaker === "A" ? speakers.A : speakers.B;
        if (!speaker) throw new HttpError(409, "waiting_second_player", "A próxima fala é do segundo jogador; aguarde alguém entrar no mundo.");
        const cursor = world.script_cursor;
        const { data: claimed } = await admin.from("worlds").update({ script_cursor: cursor + 1 }).eq("id", world.id).eq("script_cursor", cursor).select("id").maybeSingle<{ id: string }>();
        if (!claimed) return json({ ok: true, done: false, skipped: true, status: await buildStatus(admin, session, await loadWorld(admin, world.code)) });
        const { data: msg } = await admin
          .from("messages")
          .insert({ room_id: world.room_id, session_id: session.id, sender_profile_id: speaker, content: line.text, client_msg_id: `script-${world.id.slice(0, 8)}-${Date.now()}-${cursor}`, source: "script" })
          .select("id")
          .maybeSingle<{ id: string }>();
        await admin.from("audit_events").insert({ session_id: session.id, room_id: world.room_id, event_type: "script.advanced", actor_type: "presenter", payload: { index: cursor, speaker: line.speaker, force_llm: Boolean(line.forceLlm) } });
        if (msg) await runAnalysis(admin, { roomId: world.room_id, triggerType: line.forceLlm ? "script_forced" : "message", triggerMessageId: msg.id, forceLlm: Boolean(line.forceLlm) });
        return json({ ok: true, done: cursor + 1 >= scenario.script.length, line: { index: cursor, speaker: line.speaker, note: line.note ?? null, forceLlm: Boolean(line.forceLlm) }, status: await buildStatus(admin, session, await loadWorld(admin, world.code)) });
      }
    }
    throw new HttpError(400, "unknown_action");
  }),
);

async function loadWorld(admin: Admin, code: string): Promise<WorldRow> {
  const { data } = await admin.from("worlds").select("id, code, name, status, room_id, scenario, script_cursor, created_by_profile_id, created_at").eq("code", code.toUpperCase()).maybeSingle<WorldRow>();
  if (!data) throw new HttpError(404, "world_not_found");
  return data;
}

async function ensurePresenter(admin: Admin, sessionId: string, userId: string): Promise<void> {
  const existing = await findProfile(admin, sessionId, userId, "presenter");
  if (existing) return;
  const { data } = await admin.from("profiles").insert({ session_id: sessionId, role: "presenter", persona_key: "presenter", display_name: "Apresentador", tagline: "Central da demonstração", avatar: "P", is_synthetic: false }).select("id").single<{ id: string }>();
  if (data) await admin.from("profile_bindings").insert({ profile_id: data.id, auth_user_id: userId });
}

/** Jogadores do mundo por ordem de entrada: A = criador (primeiro), B = segundo. */
async function worldSpeakers(admin: Admin, world: WorldRow): Promise<{ A: string | null; B: string | null }> {
  const { data } = await admin.from("room_members").select("profile_id, joined_at").eq("room_id", world.room_id).order("joined_at", { ascending: true });
  const ids = (data ?? []).map((m) => m.profile_id as string);
  return { A: ids[0] ?? null, B: ids[1] ?? null };
}

async function health(admin: Admin, session: GlobalSession) {
  const { data: breaker } = await admin.from("system_state").select("value").eq("key", "llm_breaker").maybeSingle<{ value: { failures: number; open_until: string | null } }>();
  const cfg = claudeConfigFromEnv();
  return {
    database: "ok",
    ai: { configured: Boolean(cfg), model: cfg?.model ?? null, breakerOpenUntil: breaker?.value?.open_until ?? null, failures: breaker?.value?.failures ?? 0, disabledBySetting: Boolean((session.settings ?? {})["llm_disabled"]), forceFailure: Boolean((session.settings ?? {})["force_llm_failure"]) },
    rulesVersion: RULES_VERSION,
    serverTime: new Date().toISOString(),
    settings: session.settings ?? {},
  };
}

async function buildStatus(admin: Admin, session: GlobalSession, world: WorldRow) {
  const sc = SCENARIOS[world.scenario];
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [roomRes, membersRes, profilesRes, messagesRes, jobsRes, alertsRes, casesRes, ledgerRes, dayLedgerRes, samplesRes, breakerRes, budgetRes] = await Promise.all([
    admin.from("rooms").select("id, code, name, safety_level, safety_score, contained, analysis_pending").eq("id", world.room_id).single(),
    admin.from("room_members").select("profile_id, joined_at").eq("room_id", world.room_id).order("joined_at", { ascending: true }),
    admin.from("profiles").select("id, persona_key, role, display_name, tagline, avatar").eq("session_id", session.id),
    admin.from("messages").select("id", { count: "exact", head: true }).eq("room_id", world.room_id),
    admin.from("analysis_jobs").select("status, degraded, rule_latency_ms, llm_latency_ms, degraded_reason").eq("room_id", world.room_id),
    admin.from("alerts").select("level").eq("room_id", world.room_id),
    admin.from("cases").select("status").eq("room_id", world.room_id),
    admin.from("usage_ledger").select("input_tokens, output_tokens, est_cost_usd, cached, status, model").eq("room_id", world.room_id),
    admin.from("usage_ledger").select("est_cost_usd").gte("created_at", dayStart.toISOString()),
    admin.from("metric_samples").select("kind, value_ms").eq("room_id", world.room_id),
    admin.from("system_state").select("value").eq("key", "llm_breaker").maybeSingle<{ value: { failures: number; open_until: string | null } }>(),
    admin.from("system_state").select("value").eq("key", "budget").maybeSingle<{ value: Record<string, number> }>(),
  ]);
  const room = roomRes.data;
  const members = membersRes.data ?? [];
  const profiles = profilesRes.data;
  const memberProfiles = members.map((m, i) => ({ slot: i === 0 ? "A" : "B", ...(profiles ?? []).find((p) => p.id === m.profile_id) }));
  const messages = messagesRes.count;
  const jobs = jobsRes.data;
  const alerts = alertsRes.data;
  const cases = casesRes.data;
  const ledger = ledgerRes.data;
  const dayLedger = dayLedgerRes.data;
  const samples = samplesRes.data;
  const breaker = breakerRes.data;
  const budget = budgetRes.data;
  const cfg = claudeConfigFromEnv();
  const dailyBudget = Number(Deno.env.get("DAILY_BUDGET_USD") ?? budget?.value?.daily_budget_usd ?? 2);
  const roomLimit = Number(Deno.env.get("ROOM_LLM_CALL_LIMIT") ?? budget?.value?.room_call_limit ?? 50);

  const daySpent = (dayLedger ?? []).reduce((s, r) => s + Number(r.est_cost_usd ?? 0), 0);
  const sessionCost = (ledger ?? []).reduce((s, r) => s + Number(r.est_cost_usd ?? 0), 0);
  const calls = (ledger ?? []).filter((l) => !l.cached).length;
  const stat = (kind: string) => {
    const v = (samples ?? []).filter((s) => s.kind === kind).map((s) => Number(s.value_ms)).sort((x, y) => x - y);
    if (v.length === 0) return null;
    return { n: v.length, p50: v[Math.floor(v.length / 2)] ?? null, max: v[v.length - 1] ?? null };
  };
  const ruleLat = (jobs ?? []).map((j) => j.rule_latency_ms).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  const llmLat = (jobs ?? []).map((j) => j.llm_latency_ms).filter((x): x is number => typeof x === "number" && x > 0).sort((a, b) => a - b);

  return {
    world: { id: world.id, code: world.code, name: world.name, status: world.status, scenario: world.scenario, scriptCursor: world.script_cursor, scriptLength: sc.script.length, createdAt: world.created_at },
    session: { id: session.id, code: session.code, settings: session.settings ?? {} },
    scenario: { key: sc.key, title: sc.title, description: sc.description, expectation: sc.expectation, personas: sc.personas, script: sc.script.map((l, i) => ({ index: i, speaker: l.speaker, text: l.text, note: l.note ?? null, forceLlm: Boolean(l.forceLlm) })) },
    room,
    players: memberProfiles,
    metrics: {
      messages: messages ?? 0,
      participantsConnected: members.length,
      analyses: (jobs ?? []).filter((j) => j.status === "completed" || j.status === "degraded").length,
      fallbacks: (jobs ?? []).filter((j) => j.degraded).length,
      failed: (jobs ?? []).filter((j) => j.status === "failed").length,
      lastDegradedReason: (jobs ?? []).filter((j) => j.degraded).map((j) => j.degraded_reason).at(-1) ?? null,
      alertsByLevel: { baixo: 0, atencao: 0, alto: 0, critico: 0, ...countBy((alerts ?? []).map((a) => a.level as string)) },
      casesByStatus: countBy((cases ?? []).map((c) => c.status as string)),
      ruleLatencyMs: ruleLat.length ? { p50: ruleLat[Math.floor(ruleLat.length / 2)], max: ruleLat[ruleLat.length - 1], n: ruleLat.length } : null,
      llmLatencyMs: llmLat.length ? { p50: llmLat[Math.floor(llmLat.length / 2)], max: llmLat[llmLat.length - 1], n: llmLat.length } : null,
      deliveryLatencyMs: stat("delivery_ms"),
      realtimeConnectMs: stat("realtime_connect_ms"),
    },
    usage: {
      calls,
      cachedHits: (ledger ?? []).filter((l) => l.cached).length,
      errors: (ledger ?? []).filter((l) => l.status === "error").length,
      inputTokens: (ledger ?? []).reduce((s, r) => s + Number(r.input_tokens ?? 0), 0),
      outputTokens: (ledger ?? []).reduce((s, r) => s + Number(r.output_tokens ?? 0), 0),
      sessionCostUsd: round6(sessionCost),
      dailySpentUsd: round6(daySpent),
      dailyBudgetUsd: dailyBudget,
      dailyRemainingUsd: round6(Math.max(0, dailyBudget - daySpent)),
      roomCallLimit: roomLimit,
      roomCallsRemaining: Math.max(0, roomLimit - calls),
    },
    health: await health(admin, session),
  };
}

function countBy(values: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of values) out[v] = (out[v] ?? 0) + 1;
  return out;
}
function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
