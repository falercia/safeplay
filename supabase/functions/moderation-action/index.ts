import { z } from "zod";
import { handle, HttpError, json, readJson } from "../_shared/deno/http.ts";
import { adminClient, requireUser } from "../_shared/deno/supabase.ts";
import { runAnalysis } from "../_shared/deno/pipeline.ts";
import { RULES_VERSION } from "../_shared/risk/index.ts";

const Body = z.object({
  caseId: z.string().uuid(),
  action: z.enum(["confirm_risk", "dismiss_false_positive", "request_context", "apply_demo_containment", "approve_term", "reject_term", "reanalyze"]),
  justification: z.string().min(10).max(1000),
  payload: z.record(z.unknown()).default({}),
});

/**
 * Ações humanas de moderação. Toda ação exige justificativa e gera auditoria.
 * Nenhuma ação é automática: este endpoint só é acionado por um moderador autenticado.
 */
Deno.serve(
  handle(async (req) => {
    const admin = adminClient();
    const user = await requireUser(req, admin);
    const body = Body.parse(await readJson(req));

    const { data: kase } = await admin
      .from("cases")
      .select("id, room_id, session_id, status, priority, level")
      .eq("id", body.caseId)
      .maybeSingle<{ id: string; room_id: string; session_id: string; status: string; priority: number; level: string }>();
    if (!kase) throw new HttpError(404, "case_not_found");

    // moderador vinculado à sessão do caso
    const { data: bindings } = await admin.from("profile_bindings").select("profile_id").eq("auth_user_id", user.id);
    const myProfiles = (bindings ?? []).map((b) => b.profile_id as string);
    const { data: mod } = myProfiles.length
      ? await admin.from("profiles").select("id").eq("session_id", kase.session_id).eq("role", "moderator").in("id", myProfiles).limit(1).maybeSingle<{ id: string }>()
      : { data: null };
    if (!mod) throw new HttpError(403, "not_a_moderator");

    const now = new Date().toISOString();
    let update: Record<string, unknown> = { status: "in_review" };
    let roomUpdate: Record<string, unknown> | null = null;
    let reanalyze = false;
    let extraPayload: Record<string, unknown> = {};

    switch (body.action) {
      case "confirm_risk":
        update = { status: "confirmed", resolution: "risco_confirmado_hipotese_validada", resolved_at: now };
        break;
      case "dismiss_false_positive":
        update = { status: "dismissed", resolution: "falso_positivo_descartado", resolved_at: now };
        roomUpdate = { contained: false, contained_reason: null };
        break;
      case "request_context":
        update = { status: "needs_context" };
        reanalyze = true;
        break;
      case "apply_demo_containment":
        update = { status: "contained", resolution: "contencao_temporaria_de_demonstracao", resolved_at: now };
        roomUpdate = { contained: true, contained_reason: "Contenção temporária de demonstração aplicada por um moderador humano. Nenhuma punição automática." };
        break;
      case "reanalyze":
        update = { status: kase.status === "open" ? "in_review" : kase.status };
        reanalyze = true;
        break;
      case "approve_term":
      case "reject_term": {
        const termId = z.string().uuid().parse(body.payload["termId"]);
        const status = body.action === "approve_term" ? "approved" : "rejected";
        const { data: term } = await admin.from("glossary_terms").select("id, term, session_id, version").eq("id", termId).maybeSingle<{ id: string; term: string; session_id: string | null; version: number }>();
        if (!term || term.session_id !== kase.session_id) throw new HttpError(404, "term_not_found");
        await admin.from("glossary_terms").update({ status, reviewed_by_profile_id: mod.id, reviewed_at: now, version: term.version + 1, proposed_by: "moderador" }).eq("id", termId);
        update = { status: kase.status };
        extraPayload = { termId, term: term.term, newStatus: status, glossaryVersion: term.version + 1 };
        reanalyze = status === "approved";
        break;
      }
    }

    await admin.from("cases").update(update).eq("id", kase.id);
    if (roomUpdate) await admin.from("rooms").update(roomUpdate).eq("id", kase.room_id);

    const { data: action } = await admin
      .from("case_actions")
      .insert({ case_id: kase.id, session_id: kase.session_id, actor_profile_id: mod.id, action: body.action, justification: body.justification, payload: { ...body.payload, ...extraPayload } })
      .select("id")
      .single<{ id: string }>();

    await admin.from("audit_events").insert({
      session_id: kase.session_id,
      room_id: kase.room_id,
      case_id: kase.id,
      event_type: `case.${body.action}`,
      actor_type: "human",
      actor_profile_id: mod.id,
      rules_version: RULES_VERSION,
      payload: { action_id: action?.id ?? null, justification: body.justification, previous_status: kase.status, new_status: update["status"], ...extraPayload },
    });

    if (reanalyze) {
      await runAnalysis(admin, { roomId: kase.room_id, triggerType: "moderator_reanalysis", moderatorRequested: true, actorProfileId: mod.id });
    }

    const { data: updated } = await admin.from("cases").select("id, status, priority, level, resolution, resolved_at").eq("id", kase.id).single();
    return json({ ok: true, case: updated });
  }),
);
