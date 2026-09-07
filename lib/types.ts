import type { Assessment, Level, Recommendation, SignalKey, Trend } from "@risk/index.ts";

export type { Assessment, Level, Recommendation, SignalKey, Trend };

export interface ProfileRow {
  id: string;
  session_id: string;
  role: "player" | "guardian" | "moderator" | "presenter";
  persona_key: "A" | "B" | "player" | "guardian" | "moderator" | "presenter";
  display_name: string;
  tagline: string;
  avatar: string;
}

export interface RoomRow {
  id: string;
  session_id: string;
  code: string;
  name: string;
  safety_level: Level;
  safety_score: number;
  last_assessment_id: string | null;
  contained: boolean;
  contained_reason: string | null;
  analysis_pending: boolean;
}

export interface MessageRow {
  id: string;
  room_id: string;
  sender_profile_id: string;
  seq: number;
  content: string;
  client_msg_id: string;
  source: "human" | "script";
  created_at: string;
}

export interface JobRow {
  id: string;
  room_id: string;
  status: "pending" | "running" | "completed" | "failed" | "degraded";
  degraded: boolean;
  degraded_reason: string | null;
  llm_trigger_reasons: string[];
  rule_latency_ms: number | null;
  llm_latency_ms: number | null;
  model: string | null;
  trigger_type: string;
  trigger_message_id: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface AssessmentRow {
  id: string;
  room_id: string;
  job_id: string | null;
  score: number;
  rule_score: number;
  llm_score: number | null;
  llm_confidence: number | null;
  level: Level;
  trend: Trend;
  recommendation: Recommendation;
  guardian_summary: string;
  divergence: boolean;
  divergence_delta: number | null;
  degraded: boolean;
  method: "regras" | "regras+llm";
  window_message_ids: string[];
  details: Assessment & { budgetReason?: string | null; cached?: boolean; triggerType?: string };
  rules_version: string;
  model: string | null;
  created_at: string;
}

export interface SignalRow {
  id: string;
  assessment_id: string;
  signal_key: SignalKey;
  occurrences: number;
  contribution: number;
  evidence_message_ids: string[];
  source: "rule" | "llm" | "both";
  confidence: number;
}

export interface AlertRow {
  id: string;
  room_id: string;
  assessment_id: string | null;
  level: Level;
  title: string;
  summary: string;
  recommendation: Recommendation;
  acknowledged_at: string | null;
  created_at: string;
}

export type CaseStatus = "open" | "in_review" | "needs_context" | "confirmed" | "dismissed" | "contained";

export interface CaseRow {
  id: string;
  room_id: string;
  session_id: string;
  status: CaseStatus;
  priority: 1 | 2 | 3;
  level: Level;
  reason: string;
  sla_minutes: number;
  sla_due_at: string;
  opened_by_assessment_id: string | null;
  latest_assessment_id: string | null;
  resolution: string | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface CaseActionRow {
  id: string;
  case_id: string;
  actor_profile_id: string | null;
  action: "confirm_risk" | "dismiss_false_positive" | "request_context" | "apply_demo_containment" | "approve_term" | "reject_term" | "reanalyze";
  justification: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface AuditRow {
  id: number;
  session_id: string;
  room_id: string | null;
  case_id: string | null;
  event_type: string;
  actor_type: "system" | "human" | "presenter";
  actor_profile_id: string | null;
  rules_version: string | null;
  model: string | null;
  latency_ms: number | null;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface GlossaryRow {
  id: string;
  session_id: string | null;
  term: string;
  signal_key: string;
  status: "approved" | "candidate" | "rejected";
  version: number;
  notes: string;
  proposed_by: string;
  created_at: string;
}

export interface JoinResult {
  ok: true;
  profile: ProfileRow;
  session: { id: string; code: string; scenario: string };
  room: { id: string; code: string; name: string } | null;
}

// ---- v2: mundos e entrada por código ----

export type WorldStatus = "open" | "closed";

export interface WorldRow {
  id: string;
  session_id: string;
  room_id: string;
  code: string;
  name: string;
  created_by_profile_id: string | null;
  status: WorldStatus;
  scenario: "saudavel" | "progressivo" | "falso_positivo";
  script_cursor: number;
  max_players: number;
  created_at: string;
  closed_at: string | null;
}

/** Linha da view `world_lobby` (mundo + contagem e nomes dos jogadores). */
export interface WorldLobbyRow {
  id: string;
  code: string;
  name: string;
  status: WorldStatus;
  created_at: string;
  max_players: number;
  session_id: string;
  room_id: string;
  players: number;
  player_names: string;
  creator_name: string | null;
}

export interface RoomMemberRow {
  room_id: string;
  profile_id: string;
  joined_at: string;
}

export interface SessionRef {
  id: string;
  code: string;
}

export interface GameEnterResult {
  ok: true;
  profile: ProfileRow;
  session: SessionRef;
  currentWorldCode: string | null;
}

export interface WorldJoinResult {
  ok: true;
  world: Pick<WorldRow, "id" | "code" | "name" | "status" | "room_id" | "scenario" | "script_cursor" | "max_players" | "created_at">;
  room: { id: string; code: string; name: string };
}

export interface RoleLoginResult {
  ok: true;
  profile: ProfileRow;
  session: SessionRef;
}

export interface WatchResult {
  ok: true;
  world: { id: string; code: string; name: string; room_id: string };
}
