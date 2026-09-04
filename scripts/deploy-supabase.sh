#!/usr/bin/env bash
# Aplica migrations, secrets e Edge Functions em um projeto Supabase hospedado.
# Requer: SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_REF, SUPABASE_DB_PASSWORD, PRESENTER_SECRET; opcional ANTHROPIC_API_KEY.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?defina SUPABASE_ACCESS_TOKEN}"
: "${SUPABASE_PROJECT_REF:?defina SUPABASE_PROJECT_REF}"
: "${PRESENTER_SECRET:?defina PRESENTER_SECRET}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SB="npx --yes supabase@latest"
$SB link --project-ref "$SUPABASE_PROJECT_REF" ${SUPABASE_DB_PASSWORD:+--password "$SUPABASE_DB_PASSWORD"}
$SB db push ${SUPABASE_DB_PASSWORD:+--password "$SUPABASE_DB_PASSWORD"}
SECRETS=(PRESENTER_SECRET="$PRESENTER_SECRET" DAILY_BUDGET_USD="${DAILY_BUDGET_USD:-2}" ROOM_LLM_CALL_LIMIT="${ROOM_LLM_CALL_LIMIT:-50}" LLM_COOLDOWN_SECONDS="${LLM_COOLDOWN_SECONDS:-15}" LLM_MIN_NEW_MESSAGES="${LLM_MIN_NEW_MESSAGES:-3}" ANTHROPIC_MODEL="${ANTHROPIC_MODEL:-claude-haiku-4-5}")
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then SECRETS+=(ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY"); fi
$SB secrets set "${SECRETS[@]}"
$SB functions deploy send-message join-room demo-control moderation-action
echo "✔ deploy concluído"
