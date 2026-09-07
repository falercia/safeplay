import type { Admin } from "./supabase.ts";
import { sha256 } from "./supabase.ts";
import { callClaude, claudeConfigFromEnv, ClaudeError, estimateCostUsd } from "./claude.ts";
import {
  budgetGuard,
  evaluate,
  extractJson,
  LEVEL_LABEL,
  LEVEL_ORDER,
  LlmOutputSchema,
  RECOMMENDATION_LABEL,
  riskFocusProfile,
  RULES_VERSION,
  shouldCallLlm,
  type GlossaryTerm,
  type Level,
  type LlmOutput,
  type SignalHit,
  type WindowMessage,
} from "../risk/index.ts";
import { buildSystemPrompt, buildUserPrompt } from "../risk/prompt.ts";

export type TriggerType = "message" | "moderator_reanalysis" | "script_forced";

export interface AnalysisRequest {
  roomId: string;
  triggerType: TriggerType;
  triggerMessageId?: string | null;
  forceLlm?: boolean;
  moderatorRequested?: boolean;
  actorProfileId?: string | null;
}

interface RoomRow {
  id: string;
  session_id: string;
  safety_level: Level;
  safety_score: number;
  contained: boolean;
}
interface SessionRow {
  id: string;
  settings: { llm_disabled?: boolean; force_llm_failure?: boolean } | null;
}
interface MessageRow {
  id: string;
  sender_profile_id: string;
  content: string;
  created_at: string;
  seq: number;
}
interface AssessmentRow {
  id: string;
  score: number;
  level: Level;
  llm_score: number | null;
  window_message_ids: string[];
  created_at: string;
}
interface BudgetSettings {
  daily_budget_usd: number;
  room_call_limit: number;
  cooldown_seconds: number;
  min_new_messages: number;
}

const LONGITUDINAL_LIMIT = 40;
const WINDOW_SIZE = 12;
const BREAKER_THRESHOLD = 3;
const BREAKER_OPEN_MS = 2 * 60 * 1000;

function envNum(name: string, fallback: number): number {
  const v = Deno.env.get(name);
  return v ? Number(v) : fallback;
}

/**
 * Executa uma análise completa de uma sala: regras → (LLM opcional) → persistência → alerta/caso → auditoria.
 * Idempotente quanto a alertas e casos (constraints únicas). Nunca lança para o chamador.
 */
export async function runAnalysis(admin: Admin, req: AnalysisRequest): Promise<void> {
  let jobId: string | null = null;
  try {
    const { data: room } = await admin.from("rooms").select("id, session_id, safety_level, safety_score, contained").eq("id", req.roomId).single<RoomRow>();
    if (!room) return;

    // coalescência: se já há um job rodando nesta sala, registra como pendente e sai.
    const { data: running } = await admin
      .from("analysis_jobs")
      .select("id, created_at")
      .eq("room_id", room.id)
      .eq("status", "running")
      .gte("created_at", new Date(Date.now() - 20_000).toISOString())
      .limit(1);
    const { data: job } = await admin
      .from("analysis_jobs")
      .insert({
        room_id: room.id,
        session_id: room.session_id,
        trigger_type: req.triggerType,
        trigger_message_id: req.triggerMessageId ?? null,
        status: running && running.length > 0 ? "pending" : "running",
        started_at: new Date().toISOString(),
        rules_version: RULES_VERSION,
      })
      .select("id, status")
      .single<{ id: string; status: string }>();
    if (!job) return;
    jobId = job.id;
    if (job.status === "pending") return; // o job em execução fará a passada final

    await admin.from("rooms").update({ analysis_pending: true }).eq("id", room.id);
    await executeJob(admin, room, jobId, req);

    // passada final para jobs coalescidos
    const { data: pend } = await admin.from("analysis_jobs").select("id").eq("room_id", room.id).eq("status", "pending");
    if (pend && pend.length > 0) {
      await admin.from("analysis_jobs").update({ status: "completed", finished_at: new Date().toISOString(), error_code: "coalesced" }).in("id", pend.map((p) => p.id));
      const { data: fresh } = await admin.from("rooms").select("id, session_id, safety_level, safety_score, contained").eq("id", room.id).single<RoomRow>();
      if (fresh) {
        const { data: job2 } = await admin
          .from("analysis_jobs")
          .insert({ room_id: room.id, session_id: room.session_id, trigger_type: "message", status: "running", started_at: new Date().toISOString(), rules_version: RULES_VERSION })
          .select("id")
          .single<{ id: string }>();
        if (job2) await executeJob(admin, fresh, job2.id, { roomId: room.id, triggerType: "message" });
      }
    }
  } catch (e) {
    console.error("analysis_failed", e instanceof Error ? e.message.slice(0, 200) : "unknown");
    if (jobId) await admin.from("analysis_jobs").update({ status: "failed", finished_at: new Date().toISOString(), error_code: "exception" }).eq("id", jobId);
    await admin.from("rooms").update({ analysis_pending: false }).eq("id", req.roomId);
  }
}

async function executeJob(admin: Admin, room: RoomRow, jobId: string, req: AnalysisRequest): Promise<void> {
  const t0 = Date.now();
  // consultas independentes em paralelo (reduz latência entre Edge Function e banco)
  const [sessionRes, msgRes, prevRes, lastLlmRes, glossaryRes, openCaseRes, lastResolvedRes, budgetRow, priorSignalsRes] = await Promise.all([
    admin.from("demo_sessions").select("id, settings").eq("id", room.session_id).single<SessionRow>(),
    admin.from("messages").select("id, sender_profile_id, content, created_at, seq").eq("room_id", room.id).order("seq", { ascending: false }).limit(LONGITUDINAL_LIMIT),
    admin.from("risk_assessments").select("id, score, level, llm_score, window_message_ids, created_at").eq("room_id", room.id).order("created_at", { ascending: false }).limit(1).maybeSingle<AssessmentRow>(),
    admin.from("risk_assessments").select("id, score, level, llm_score, window_message_ids, created_at").eq("room_id", room.id).not("llm_score", "is", null).order("created_at", { ascending: false }).limit(1).maybeSingle<AssessmentRow>(),
    admin.from("glossary_terms").select("term, signal_key, status, version, notes").or(`session_id.is.null,session_id.eq.${room.session_id}`),
    admin.from("cases").select("id, status, priority, sla_due_at, level").eq("room_id", room.id).in("status", ["open", "in_review", "needs_context"]).maybeSingle<{ id: string; status: string; priority: number; sla_due_at: string; level: Level }>(),
    admin.from("cases").select("id, status, level, resolved_at").eq("room_id", room.id).in("status", ["confirmed", "dismissed", "contained"]).order("resolved_at", { ascending: false }).limit(1).maybeSingle<{ id: string; status: string; level: Level; resolved_at: string }>(),
    admin.from("system_state").select("value").eq("key", "budget").maybeSingle<{ value: BudgetSettings }>(),
    admin.from("risk_signals").select("signal_key, evidence_message_ids, confidence, source, assessment_id").eq("room_id", room.id).in("source", ["llm", "both"]).order("created_at", { ascending: false }).limit(80),
  ]);
  const session = sessionRes.data;
  const messages: WindowMessage[] = ((msgRes.data ?? []) as MessageRow[])
    .map((m) => ({ id: m.id, senderId: m.sender_profile_id, content: m.content, createdAt: m.created_at, seq: m.seq }))
    .sort((a, b) => a.seq - b.seq);
  const prev = prevRes.data;
  const lastLlm = lastLlmRes.data;
  const glossary: GlossaryTerm[] = (glossaryRes.data ?? []).map((g) => ({
    term: g.term as string,
    signal: g.signal_key as GlossaryTerm["signal"],
    status: g.status as GlossaryTerm["status"],
    version: g.version as number,
    notes: g.notes as string,
  }));
  const openCase = openCaseRes.data;
  const lastResolved = lastResolvedRes.data;

  const nowIso = new Date().toISOString();

  // memória longitudinal: sinais apontados pela LLM em avaliações anteriores (evidências ainda na janela)
  const byId = new Map(messages.map((m) => [m.id, m]));
  const priorLlmHits: SignalHit[] = [];
  for (const row of (priorSignalsRes.data ?? []) as { signal_key: string; evidence_message_ids: string[]; confidence: number; source: string }[]) {
    for (const id of row.evidence_message_ids ?? []) {
      const m = byId.get(id);
      if (!m) continue;
      priorLlmHits.push({ signal: row.signal_key as SignalHit["signal"], messageId: id, senderId: m.senderId, at: m.createdAt, pattern: "sinal apontado pela LLM em avaliação anterior", confidence: Number(row.confidence ?? 0.6), source: "llm" });
    }
  }
  const memory = { previousAt: prev?.created_at ?? null, priorLlmHits };

  // ---- passada determinística ----
  const tRule = Date.now();
  const prelim = evaluate({ messages, nowIso, previousScore: prev?.score ?? null, previousLevel: prev?.level ?? null, ...memory, glossary, windowSize: WINDOW_SIZE, hasOpenCase: Boolean(openCase) });
  const ruleLatency = Date.now() - tRule;

  // ---- decisão de chamar a LLM ----
  const budgetSettings: BudgetSettings = {
    daily_budget_usd: envNum("DAILY_BUDGET_USD", budgetRow.data?.value?.daily_budget_usd ?? 2),
    room_call_limit: envNum("ROOM_LLM_CALL_LIMIT", budgetRow.data?.value?.room_call_limit ?? 50),
    cooldown_seconds: envNum("LLM_COOLDOWN_SECONDS", budgetRow.data?.value?.cooldown_seconds ?? 15),
    min_new_messages: envNum("LLM_MIN_NEW_MESSAGES", budgetRow.data?.value?.min_new_messages ?? 3),
  };
  const lastLlmMaxSeq = lastLlm ? Math.max(0, ...messages.filter((m) => lastLlm.window_message_ids.includes(m.id)).map((m) => m.seq)) : 0;
  const newSinceLlm = messages.filter((m) => m.seq > lastLlmMaxSeq).length;
  const distinctInWindow = new Set(prelim.hits.filter((h) => prelim.windowMessageIds.includes(h.messageId)).map((h) => h.signal)).size;
  const triggerReasons = shouldCallLlm({
    ruleScore: prelim.assessment.ruleScore,
    distinctSignalsInWindow: distinctInWindow,
    newMessagesSinceLastLlm: newSinceLlm,
    moderatorRequested: Boolean(req.moderatorRequested),
    scenarioForced: Boolean(req.forceLlm),
    minNewMessages: budgetSettings.min_new_messages,
  });

  let llm: LlmOutput | null = null;
  let degradedReason: string | null = null;
  let llmLatency: number | null = null;
  let modelUsed: string | null = null;
  let budgetReason: string | null = null;
  let cached = false;

  if (triggerReasons.length > 0) {
    const cfg = claudeConfigFromEnv();
    const guard = await evaluateBudget(admin, room, session, budgetSettings, Boolean(cfg), nowIso);
    if (!guard.allowed) {
      degradedReason = guard.reason;
      budgetReason = guard.reason;
    } else if (cfg) {
      const window = messages.slice(-WINDOW_SIZE);
      const system = buildSystemPrompt(glossary);
      const user = buildUserPrompt(window, prelim.assessment.ruleScore, prelim.assessment.contributions.map((c) => c.signal));
      const hash = await sha256(`${cfg.model}|${RULES_VERSION}|${window.map((m) => `${m.id}:${m.content}`).join("\n")}`);
      const { data: cacheRow } = await admin.from("llm_cache").select("response").eq("hash", hash).maybeSingle<{ response: unknown }>();
      modelUsed = cfg.model;
      if (cacheRow) {
        const parsed = LlmOutputSchema.safeParse(cacheRow.response);
        if (parsed.success) {
          llm = parsed.data;
          cached = true;
          llmLatency = 0;
          await admin.from("usage_ledger").insert({ session_id: room.session_id, room_id: room.id, job_id: jobId, model: cfg.model, input_tokens: 0, output_tokens: 0, est_cost_usd: 0, cached: true, status: "ok" });
        }
      }
      if (!llm) {
        const forceFailure = Boolean(session?.settings?.force_llm_failure);
        const tLlm = Date.now();
        try {
          const first = await callClaude(cfg, system, user, forceFailure);
          let totalIn = first.inputTokens;
          let totalOut = first.outputTokens;
          modelUsed = first.model;
          let parsed = safeParseLlm(first.text);
          if (!parsed.ok) {
            // uma única tentativa curta de reparação; depois, fallback
            const repair = await callClaude(cfg, system, `${user}\n\nSua resposta anterior não era JSON válido conforme o esquema (${parsed.error}). Responda novamente APENAS com o JSON.`, forceFailure);
            totalIn += repair.inputTokens;
            totalOut += repair.outputTokens;
            parsed = safeParseLlm(repair.text);
          }
          llmLatency = Date.now() - tLlm;
          const cost = estimateCostUsd(modelUsed, totalIn, totalOut);
          await admin.from("usage_ledger").insert({ session_id: room.session_id, room_id: room.id, job_id: jobId, model: modelUsed, input_tokens: totalIn, output_tokens: totalOut, est_cost_usd: cost, cached: false, status: parsed.ok ? "ok" : "error" });
          if (parsed.ok) {
            llm = parsed.value;
            await admin.from("llm_cache").upsert({ hash, model: modelUsed, response: llm });
            await breakerRecord(admin, true);
          } else {
            degradedReason = "resposta_invalida_da_llm";
            await breakerRecord(admin, false);
          }
        } catch (e) {
          llmLatency = Date.now() - tLlm;
          degradedReason = e instanceof ClaudeError ? `llm_${e.code}` : "llm_erro_desconhecido";
          await admin.from("usage_ledger").insert({ session_id: room.session_id, room_id: room.id, job_id: jobId, model: cfg.model, input_tokens: 0, output_tokens: 0, est_cost_usd: 0, cached: false, status: "error" });
          await breakerRecord(admin, false);
        }
      }
    }
  }

  // ---- avaliação final ----
  const final = evaluate({
    messages,
    nowIso,
    previousScore: prev?.score ?? null,
    previousLevel: prev?.level ?? null,
    ...memory,
    glossary,
    windowSize: WINDOW_SIZE,
    llm,
    degradedReason,
    llmTriggerReasons: triggerReasons,
    hasOpenCase: Boolean(openCase),
  });
  const a = final.assessment;
  const esc = final.escalation;
  // direcionamento da comunicação: quem concentra os sinais (hipótese) não recebe o aviso de acolhimento
  const riskFocus = a.level === "baixo" ? null : riskFocusProfile([...final.hits, ...memory.priorLlmHits]);

  const { data: saved } = await admin
    .from("risk_assessments")
    .insert({
      room_id: room.id,
      session_id: room.session_id,
      job_id: jobId,
      score: a.score,
      rule_score: a.ruleScore,
      llm_score: a.llmScore,
      llm_confidence: a.llmConfidence,
      level: a.level,
      trend: a.trend,
      recommendation: a.recommendation,
      guardian_summary: a.guardianSummary,
      divergence: a.divergence,
      divergence_delta: a.divergenceDelta,
      degraded: a.degraded,
      method: a.method,
      window_message_ids: a.windowMessageIds,
      details: { ...a, budgetReason, cached, triggerType: req.triggerType },
      rules_version: a.rulesVersion,
      model: modelUsed,
    })
    .select("id")
    .single<{ id: string }>();
  if (!saved) throw new Error("assessment_insert_failed");

  if (a.contributions.length > 0) {
    await admin.from("risk_signals").insert(
      a.contributions.map((c) => ({
        assessment_id: saved.id,
        room_id: room.id,
        session_id: room.session_id,
        signal_key: c.signal,
        occurrences: c.occurrences,
        contribution: c.contribution,
        evidence_message_ids: c.evidenceMessageIds,
        source: c.source,
        confidence: c.confidence,
      })),
    );
  }

  // candidatos de glossário (sujeitos a aprovação humana)
  for (const cand of a.candidateTerms) {
    const term = cand.term.toLowerCase().slice(0, 40);
    const { data: exists } = await admin.from("glossary_terms").select("id").or(`session_id.is.null,session_id.eq.${room.session_id}`).ilike("term", term).limit(1);
    if (exists && exists.length > 0) continue;
    await admin
      .from("glossary_terms")
      .insert({ session_id: room.session_id, term, signal_key: "linguagem_codificada", status: "candidate", notes: `[candidato ${cand.source}] ${cand.reason}`.slice(0, 200), proposed_by: cand.source })
      .then(() => undefined, () => undefined);
  }

  // ---- EscalationAgent: alerta e caso (idempotentes) ----
  let alertId: string | null = null;
  if (esc.alert.send && esc.alert.reason) {
    const { data: al } = await admin
      .from("alerts")
      .upsert(
        {
          room_id: room.id,
          session_id: room.session_id,
          assessment_id: saved.id,
          level: a.level,
          title: `${LEVEL_LABEL[a.level]}: ${RECOMMENDATION_LABEL[a.recommendation].toLowerCase()}`,
          summary: a.guardianSummary,
          recommendation: a.recommendation,
          dedupe_key: `${room.id}:${a.level}:${esc.alert.reason}`,
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true },
      )
      .select("id")
      .maybeSingle<{ id: string }>();
    alertId = al?.id ?? null;
  }

  let caseId: string | null = openCase?.id ?? null;
  let caseEvent: "case.opened" | "case.updated" | "case.suppressed_after_resolution" | null = null;
  // após decisão humana, só reabre caso se o nível subir acima do nível já revisado
  const suppressedByResolution = !openCase && lastResolved !== null && LEVEL_ORDER[a.level] <= LEVEL_ORDER[lastResolved.level];
  if (esc.caseRequest.open && suppressedByResolution) {
    caseEvent = "case.suppressed_after_resolution";
    caseId = lastResolved?.id ?? null;
  } else if (esc.caseRequest.open && esc.caseRequest.priority && esc.caseRequest.slaMinutes) {
    const due = new Date(Date.now() + esc.caseRequest.slaMinutes * 60_000).toISOString();
    if (openCase) {
      const escalated = esc.caseRequest.priority < openCase.priority;
      await admin
        .from("cases")
        .update({
          priority: Math.min(openCase.priority, esc.caseRequest.priority),
          level: a.level,
          latest_assessment_id: saved.id,
          reason: escalated ? esc.caseRequest.reason : undefined,
          sla_due_at: escalated && new Date(due) < new Date(openCase.sla_due_at) ? due : openCase.sla_due_at,
          sla_minutes: escalated ? esc.caseRequest.slaMinutes : undefined,
        })
        .eq("id", openCase.id);
      caseEvent = "case.updated";
    } else {
      const { data: c, error: caseErr } = await admin
        .from("cases")
        .insert({
          room_id: room.id,
          session_id: room.session_id,
          status: "open",
          priority: esc.caseRequest.priority,
          level: a.level,
          reason: esc.caseRequest.reason ?? "politica",
          sla_minutes: esc.caseRequest.slaMinutes,
          sla_due_at: due,
          opened_by_assessment_id: saved.id,
          latest_assessment_id: saved.id,
        })
        .select("id")
        .maybeSingle<{ id: string }>();
      if (c && !caseErr) {
        caseId = c.id;
        caseEvent = "case.opened";
      } else {
        // corrida ou índice único parcial: outro job abriu o caso; apenas atualiza
        const { data: existing } = await admin.from("cases").select("id").eq("room_id", room.id).in("status", ["open", "in_review", "needs_context"]).maybeSingle<{ id: string }>();
        caseId = existing?.id ?? null;
        if (caseId) await admin.from("cases").update({ latest_assessment_id: saved.id, level: a.level }).eq("id", caseId);
        caseEvent = caseId ? "case.updated" : null;
      }
    }
  } else if (openCase) {
    await admin.from("cases").update({ latest_assessment_id: saved.id }).eq("id", openCase.id);
  }

  const totalLatency = Date.now() - t0;
  const status = degradedReason ? "degraded" : "completed";
  await Promise.all([
    admin.from("rooms").update({ safety_level: a.level, safety_score: a.score, last_assessment_id: saved.id, analysis_pending: false, risk_focus_profile_id: riskFocus }).eq("id", room.id),
    admin
    .from("analysis_jobs")
    .update({
      status,
      degraded: Boolean(degradedReason),
      degraded_reason: degradedReason,
      llm_trigger_reasons: triggerReasons,
      rule_latency_ms: ruleLatency,
      llm_latency_ms: llmLatency,
      model: modelUsed,
      finished_at: new Date().toISOString(),
    })
    .eq("id", jobId),
  ]);

  // ---- auditoria ----
  const events: Record<string, unknown>[] = [
    {
      session_id: room.session_id,
      room_id: room.id,
      case_id: caseId,
      event_type: "analysis.completed",
      actor_type: "system",
      rules_version: a.rulesVersion,
      model: modelUsed,
      latency_ms: totalLatency,
      payload: {
        job_id: jobId,
        trigger: req.triggerType,
        trigger_message_id: req.triggerMessageId ?? null,
        window_message_ids: a.windowMessageIds,
        signals: a.contributions.map((c) => ({ key: c.signal, contribution: c.contribution, occurrences: c.occurrences, source: c.source, evidence: c.evidenceMessageIds })),
        score: a.score,
        rule_score: a.ruleScore,
        llm_score: a.llmScore,
        level: a.level,
        trend: a.trend,
        method: a.method,
        divergence: a.divergence,
        risk_focus_profile_id: riskFocus,
        llm_trigger_reasons: triggerReasons,
        budget_reason: budgetReason,
        degraded: a.degraded,
        degraded_reason: degradedReason,
        cached,
        rule_latency_ms: ruleLatency,
        llm_latency_ms: llmLatency,
        recommended_action: esc.recommendedAction,
        agents: a.agentsInvoked,
        assessment_id: saved.id,
        explanation_note: "Explicação baseada em evidências (IDs de mensagens e sinais), não em cadeia de pensamento do modelo.",
      },
    },
  ];
  if (alertId) {
    events.push({ session_id: room.session_id, room_id: room.id, case_id: caseId, event_type: "alert.created", actor_type: "system", rules_version: a.rulesVersion, model: modelUsed, payload: { alert_id: alertId, level: a.level, recommendation: a.recommendation, assessment_id: saved.id } });
  }
  if (caseEvent && caseId) {
    events.push({ session_id: room.session_id, room_id: room.id, case_id: caseId, event_type: caseEvent, actor_type: "system", rules_version: a.rulesVersion, model: modelUsed, payload: { case_id: caseId, priority: esc.caseRequest.priority, level: a.level, reason: esc.caseRequest.reason, recommended_action: esc.recommendedAction, assessment_id: saved.id, resolved_level: lastResolved?.level ?? null } });
  }
  await admin.from("audit_events").insert(events);
}

function safeParseLlm(text: string): { ok: true; value: LlmOutput } | { ok: false; error: string } {
  try {
    const parsed = LlmOutputSchema.safeParse(extractJson(text));
    if (parsed.success) return { ok: true, value: parsed.data };
    return { ok: false, error: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "parse_error" };
  }
}

async function evaluateBudget(admin: Admin, room: RoomRow, session: SessionRow | null, s: BudgetSettings, hasApiKey: boolean, nowIso: string) {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);
  const [dayRes, roomCallsRes, lastRes, breakerRes] = await Promise.all([
    admin.from("usage_ledger").select("est_cost_usd").gte("created_at", dayStart.toISOString()),
    admin.from("usage_ledger").select("id", { count: "exact", head: true }).eq("room_id", room.id).eq("cached", false),
    admin.from("usage_ledger").select("created_at").eq("room_id", room.id).eq("cached", false).order("created_at", { ascending: false }).limit(1).maybeSingle<{ created_at: string }>(),
    admin.from("system_state").select("value").eq("key", "llm_breaker").maybeSingle<{ value: { failures: number; open_until: string | null } }>(),
  ]);
  const dailySpent = (dayRes.data ?? []).reduce((acc, r) => acc + Number(r.est_cost_usd ?? 0), 0);
  const roomCalls = roomCallsRes.count;
  const last = lastRes.data;
  const breaker = breakerRes.data;
  return budgetGuard({
    dailySpentUsd: dailySpent,
    dailyBudgetUsd: s.daily_budget_usd,
    roomCalls: roomCalls ?? 0,
    roomCallLimit: s.room_call_limit,
    secondsSinceLastCall: last ? (Date.now() - new Date(last.created_at).getTime()) / 1000 : null,
    cooldownSeconds: s.cooldown_seconds,
    breakerOpenUntil: breaker?.value?.open_until ?? null,
    now: nowIso,
    llmDisabledBySetting: Boolean(session?.settings?.llm_disabled),
    hasApiKey,
  });
}

async function breakerRecord(admin: Admin, success: boolean): Promise<void> {
  const { data } = await admin.from("system_state").select("value").eq("key", "llm_breaker").maybeSingle<{ value: { failures: number; open_until: string | null } }>();
  const failures = success ? 0 : (data?.value?.failures ?? 0) + 1;
  const open_until = failures >= BREAKER_THRESHOLD ? new Date(Date.now() + BREAKER_OPEN_MS).toISOString() : null;
  await admin.from("system_state").upsert({ key: "llm_breaker", value: { failures, open_until }, updated_at: new Date().toISOString() });
}
