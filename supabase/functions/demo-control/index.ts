import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, randomCode, randomToken, requirePresenterSecret, requireUser, type Admin } from "../_shared/deno/supabase.ts";
import { runAnalysis } from "../_shared/deno/pipeline.ts";
import { claudeConfigFromEnv } from "../_shared/deno/claude.ts";
import { RULES_VERSION, SCENARIOS, type ScenarioKey } from "../_shared/risk/index.ts";

const ScenarioSchema = z.enum(["saudavel", "progressivo", "falso_positivo"]);
const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), scenario: ScenarioSchema }),
  z.object({ action: z.literal("list") }),
  z.object({ action: z.literal("status"), sessionCode: z.string() }),
  z.object({ action: z.literal("reset"), sessionCode: z.string() }),
  z.object({ action: z.literal("delete"), sessionCode: z.string() }),
  z.object({ action: z.literal("set_scenario"), sessionCode: z.string(), scenario: ScenarioSchema }),
  z.object({ action: z.literal("advance"), sessionCode: z.string() }),
  z.object({ action: z.literal("set_setting"), sessionCode: z.string(), key: z.enum(["llm_disabled", "force_llm_failure"]), value: z.boolean() }),
]);

interface SessionRow {
  id: string;
  code: string;
  scenario: ScenarioKey;
  script_cursor: number;
  settings: Record<string, unknown>;
  reset_count: number;
  created_at: string;
  presenter_auth_user_id: string | null;
}

Deno.serve(
  handle(async (req) => {
    requirePresenterSecret(req);
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));

    if (body.action === "create") {
      const session = await createSession(admin, body.scenario, user.id);
      return json({ ok: true, status: await buildStatus(admin, session) });
    }
    if (body.action === "list") {
      const { data } = await admin.from("demo_sessions").select("id, code, scenario, script_cursor, created_at, reset_count").order("created_at", { ascending: false }).limit(10);
      return json({ ok: true, sessions: data ?? [] });
    }

    const session = await loadSession(admin, body.sessionCode);
    await ensurePresenterBinding(admin, session, user.id);

    switch (body.action) {
      case "status":
        return json({ ok: true, status: await buildStatus(admin, session) });
      case "reset": {
        await admin.rpc("admin_reset_session_data", { p_session: session.id });
        await admin.from("audit_events").insert({ session_id: session.id, event_type: "session.reset", actor_type: "presenter", payload: { reset_count: session.reset_count + 1 } });
        return json({ ok: true, status: await buildStatus(admin, await loadSession(admin, session.code)) });
      }
      case "delete": {
        await deleteAnonymousUsers(admin, session.id, user.id);
        await admin.rpc("admin_reset_session", { p_session: session.id });
        return json({ ok: true });
      }
      case "set_scenario": {
        await admin.rpc("admin_reset_session_data", { p_session: session.id });
        const sc = SCENARIOS[body.scenario];
        await admin.from("demo_sessions").update({ scenario: body.scenario, script_cursor: 0 }).eq("id", session.id);
        for (const key of ["A", "B"] as const) {
          await admin.from("profiles").update({ display_name: sc.personas[key].name, tagline: sc.personas[key].tagline, avatar: sc.personas[key].avatar }).eq("session_id", session.id).eq("persona_key", key);
        }
        await admin.from("audit_events").insert({ session_id: session.id, event_type: "session.scenario_changed", actor_type: "presenter", payload: { scenario: body.scenario } });
        return json({ ok: true, status: await buildStatus(admin, await loadSession(admin, session.code)) });
      }
      case "set_setting": {
        const settings = { ...(session.settings ?? {}), [body.key]: body.value };
        await admin.from("demo_sessions").update({ settings }).eq("id", session.id);
        await admin.from("audit_events").insert({ session_id: session.id, event_type: "session.setting_changed", actor_type: "presenter", payload: { key: body.key, value: body.value } });
        return json({ ok: true, status: await buildStatus(admin, await loadSession(admin, session.code)) });
      }
      case "advance": {
        const scenario = SCENARIOS[session.scenario];
        const line = scenario.script[session.script_cursor];
        if (!line) return json({ ok: true, done: true, status: await buildStatus(admin, session) });
        const { data: room } = await admin.from("rooms").select("id, contained").eq("session_id", session.id).limit(1).single<{ id: string; contained: boolean }>();
        const { data: persona } = await admin.from("profiles").select("id").eq("session_id", session.id).eq("persona_key", line.speaker).single<{ id: string }>();
        if (!room || !persona) throw new HttpError(500, "session_incomplete");
        const cursor = session.script_cursor;
        const { data: msg } = await admin
          .from("messages")
          .insert({ room_id: room.id, session_id: session.id, sender_profile_id: persona.id, content: line.text, client_msg_id: `script-${session.reset_count}-${cursor}`, source: "script" })
          .select("id")
          .maybeSingle<{ id: string }>();
        await admin.from("demo_sessions").update({ script_cursor: cursor + 1 }).eq("id", session.id);
        await admin.from("audit_events").insert({ session_id: session.id, room_id: room.id, event_type: "script.advanced", actor_type: "presenter", payload: { index: cursor, speaker: line.speaker, force_llm: Boolean(line.forceLlm) } });
        if (msg) {
          // síncrono aqui: o apresentador quer ver o efeito ao avançar (o chat já recebeu a mensagem via Realtime)
          await runAnalysis(admin, { roomId: room.id, triggerType: line.forceLlm ? "script_forced" : "message", triggerMessageId: msg.id, forceLlm: Boolean(line.forceLlm) });
        }
        return json({ ok: true, done: cursor + 1 >= scenario.script.length, line: { index: cursor, speaker: line.speaker, note: line.note ?? null, forceLlm: Boolean(line.forceLlm) }, status: await buildStatus(admin, await loadSession(admin, session.code)) });
      }
    }
    throw new HttpError(400, "unknown_action");
  }),
);

async function loadSession(admin: Admin, code: string): Promise<SessionRow> {
  const { data } = await admin.from("demo_sessions").select("id, code, scenario, script_cursor, settings, reset_count, created_at, presenter_auth_user_id").eq("code", code).maybeSingle<SessionRow>();
  if (!data) throw new HttpError(404, "session_not_found");
  return data;
}

async function ensurePresenterBinding(admin: Admin, session: SessionRow, userId: string): Promise<void> {
  const { data: presenter } = await admin.from("profiles").select("id").eq("session_id", session.id).eq("persona_key", "presenter").maybeSingle<{ id: string }>();
  if (!presenter) return;
  await admin.from("profile_bindings").upsert({ profile_id: presenter.id, auth_user_id: userId }, { onConflict: "profile_id,auth_user_id", ignoreDuplicates: true });
}

async function createSession(admin: Admin, scenarioKey: ScenarioKey, presenterUserId: string): Promise<SessionRow> {
  const sc = SCENARIOS[scenarioKey];
  const code = randomCode("MIT");
  const { data: session, error } = await admin
    .from("demo_sessions")
    .insert({ code, scenario: scenarioKey, presenter_auth_user_id: presenterUserId })
    .select("id, code, scenario, script_cursor, settings, reset_count, created_at, presenter_auth_user_id")
    .single<SessionRow>();
  if (error || !session) throw new HttpError(500, "session_create_failed");

  const { data: room } = await admin.from("rooms").insert({ session_id: session.id, code: randomCode("SP"), name: "Arena Nimbus · Sala cooperativa" }).select("id").single<{ id: string }>();
  if (!room) throw new HttpError(500, "room_create_failed");

  const personas = [
    { persona_key: "A", role: "player", display_name: sc.personas.A.name, tagline: sc.personas.A.tagline, avatar: sc.personas.A.avatar },
    { persona_key: "B", role: "player", display_name: sc.personas.B.name, tagline: sc.personas.B.tagline, avatar: sc.personas.B.avatar },
    { persona_key: "guardian", role: "guardian", display_name: "Responsável de Nico", tagline: "Painel parental (persona sintética)", avatar: "R" },
    { persona_key: "moderator", role: "moderator", display_name: "Moderação Safe Play", tagline: "Revisão humana de demonstração", avatar: "M" },
    { persona_key: "presenter", role: "presenter", display_name: "Apresentador", tagline: "Central da demonstração", avatar: "P" },
  ];
  const { data: profiles } = await admin
    .from("profiles")
    .insert(personas.map((p) => ({ ...p, session_id: session.id })))
    .select("id, persona_key, role");
  const byKey = new Map((profiles ?? []).map((p) => [p.persona_key as string, p.id as string]));
  const a = byKey.get("A");
  const b = byKey.get("B");
  const g = byKey.get("guardian");
  const m = byKey.get("moderator");
  const pr = byKey.get("presenter");
  if (!a || !b || !g || !m || !pr) throw new HttpError(500, "profiles_create_failed");

  await admin.from("room_members").insert([
    { room_id: room.id, profile_id: a },
    { room_id: room.id, profile_id: b },
  ]);
  await admin.from("guardian_links").insert({ guardian_profile_id: g, ward_profile_id: a, room_id: room.id });
  await admin.from("profile_bindings").insert({ profile_id: pr, auth_user_id: presenterUserId });
  await admin.from("invites").insert([
    { session_id: session.id, room_id: room.id, profile_id: a, role: "player", token: randomToken() },
    { session_id: session.id, room_id: room.id, profile_id: b, role: "player", token: randomToken() },
    { session_id: session.id, room_id: room.id, profile_id: g, role: "guardian", token: randomToken() },
    { session_id: session.id, room_id: room.id, profile_id: m, role: "moderator", token: randomToken() },
  ]);
  await admin.from("audit_events").insert({ session_id: session.id, room_id: room.id, event_type: "session.created", actor_type: "presenter", rules_version: RULES_VERSION, payload: { scenario: scenarioKey } });
  return session;
}

async function deleteAnonymousUsers(admin: Admin, sessionId: string, keepUserId: string): Promise<void> {
  const { data: profiles } = await admin.from("profiles").select("id").eq("session_id", sessionId);
  const ids = (profiles ?? []).map((p) => p.id as string);
  if (ids.length === 0) return;
  const { data: bindings } = await admin.from("profile_bindings").select("auth_user_id").in("profile_id", ids);
  const users = [...new Set((bindings ?? []).map((b) => b.auth_user_id as string))].filter((u) => u !== keepUserId);
  for (const u of users) {
    const { data: other } = await admin.from("profile_bindings").select("profile_id").eq("auth_user_id", u).not("profile_id", "in", `(${ids.join(",")})`).limit(1);
    if (other && other.length > 0) continue; // usuário participa de outra sessão
    await admin.auth.admin.deleteUser(u).catch(() => undefined);
  }
}

async function buildStatus(admin: Admin, session: SessionRow) {
  const sc = SCENARIOS[session.scenario];
  const { data: room } = await admin.from("rooms").select("id, code, name, safety_level, safety_score, contained, analysis_pending").eq("session_id", session.id).limit(1).single();
  const { data: invites } = await admin.from("invites").select("role, token, profile_id, uses").eq("session_id", session.id);
  const { data: profiles } = await admin.from("profiles").select("id, persona_key, role, display_name, tagline, avatar").eq("session_id", session.id);
  const profileIds = (profiles ?? []).map((p) => p.id as string);
  const { data: bindings } = await admin.from("profile_bindings").select("profile_id").in("profile_id", profileIds);
  const { count: messages } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("session_id", session.id);
  const { data: jobs } = await admin.from("analysis_jobs").select("status, degraded, rule_latency_ms, llm_latency_ms, degraded_reason").eq("session_id", session.id);
  const { data: alerts } = await admin.from("alerts").select("level").eq("session_id", session.id);
  const { data: cases } = await admin.from("cases").select("status").eq("session_id", session.id);
  const { data: ledger } = await admin.from("usage_ledger").select("input_tokens, output_tokens, est_cost_usd, cached, status, model").eq("session_id", session.id);
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const { data: dayLedger } = await admin.from("usage_ledger").select("est_cost_usd").gte("created_at", dayStart.toISOString());
  const { data: samples } = await admin.from("metric_samples").select("kind, value_ms").eq("session_id", session.id);
  const { data: breaker } = await admin.from("system_state").select("value").eq("key", "llm_breaker").maybeSingle<{ value: { failures: number; open_until: string | null } }>();
  const { data: budget } = await admin.from("system_state").select("value").eq("key", "budget").maybeSingle<{ value: Record<string, number> }>();
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
    session: { id: session.id, code: session.code, scenario: session.scenario, scriptCursor: session.script_cursor, scriptLength: sc.script.length, settings: session.settings ?? {}, resetCount: session.reset_count, createdAt: session.created_at },
    scenario: { key: sc.key, title: sc.title, description: sc.description, expectation: sc.expectation, personas: sc.personas, script: sc.script.map((l, i) => ({ index: i, speaker: l.speaker, text: l.text, note: l.note ?? null, forceLlm: Boolean(l.forceLlm) })) },
    room,
    invites: (invites ?? []).map((i) => ({ role: i.role, token: i.token, profileId: i.profile_id, uses: i.uses, persona: (profiles ?? []).find((p) => p.id === i.profile_id)?.display_name ?? null })),
    profiles: profiles ?? [],
    metrics: {
      messages: messages ?? 0,
      participantsConnected: new Set((bindings ?? []).map((b) => b.profile_id)).size,
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
    health: {
      database: "ok",
      ai: { configured: Boolean(cfg), model: cfg?.model ?? null, breakerOpenUntil: breaker?.value?.open_until ?? null, failures: breaker?.value?.failures ?? 0, disabledBySetting: Boolean((session.settings ?? {})["llm_disabled"]), forceFailure: Boolean((session.settings ?? {})["force_llm_failure"]) },
      rulesVersion: RULES_VERSION,
      serverTime: new Date().toISOString(),
    },
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
