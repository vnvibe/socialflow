#!/usr/bin/env bash
#
# Verify the anti-detect pipeline is running healthy after deploy.
# Run on the VPS. Tails pm2 logs for 5 minutes, looking for expected
# patterns + flagging anything broken.

set -uo pipefail

PM2_API_NAME="${PM2_API_NAME:-socialflow-api}"
TAIL_MINUTES=${TAIL_MINUTES:-5}

echo "=== SocialFlow Anti-Detect Verification ==="
echo "Tailing $PM2_API_NAME logs for ${TAIL_MINUTES} minutes…"
echo "(Hermes orchestrator runs every 5 min for hermes_central campaigns)"
echo

# Expected log lines (success markers):
#   [ANTI-DETECT] campaign=X autopilot=N kpi(b/n/s)=N/N/N predictor_actions=N schedule=N alloc=N (Xms)
#   [ORCHESTRATOR] campaign=X health=N actions=N auto=N
# Plus any agent log:
#   [NURTURE] Hermes-pinned group: ...

# Errors to flag:
#   ANTI-DETECT pipeline failed
#   AUTOPILOT-PHASE failed
#   KPI-PHASE failed
#   ORCHESTRATOR ... Hermes call failed
#   Hermes ... HTTP 4xx/5xx

end=$((SECONDS + TAIL_MINUTES * 60))
seen_pipeline=0
seen_orchestrator=0
errors=0

(timeout "${TAIL_MINUTES}m" pm2 logs "$PM2_API_NAME" --lines 0 --raw 2>&1) | while IFS= read -r line; do
  if [[ $SECONDS -ge $end ]]; then
    break
  fi

  case "$line" in
    *"[ANTI-DETECT]"*)
      seen_pipeline=$((seen_pipeline + 1))
      echo "[OK pipeline]  $line"
      ;;
    *"[ORCHESTRATOR] campaign="*"health="*)
      seen_orchestrator=$((seen_orchestrator + 1))
      echo "[OK llm]       $line"
      ;;
    *"[NURTURE] Hermes-pinned group"*)
      echo "[OK agent]     $line"
      ;;
    *"failed"* | *"FAILED"* | *"ERROR"* | *"HTTP 4"* | *"HTTP 5"*)
      errors=$((errors + 1))
      echo "[!! error]     $line"
      ;;
  esac
done

echo
echo "=== Verification summary ==="
echo "  pipeline ticks: $seen_pipeline (expect ≥ 1 per active campaign per 5 min)"
echo "  orchestrator runs: $seen_orchestrator"
echo "  errors flagged: $errors"
echo
if [[ $seen_pipeline -eq 0 ]]; then
  echo "[WARN] No [ANTI-DETECT] lines seen — possible causes:"
  echo "  • No hermes_central=true campaigns active"
  echo "  • Cron didn't tick yet (orchestrator runs every 5 min)"
  echo "  • HERMES_ANTIDETECT_DISABLED=1 is set"
fi
if [[ $errors -gt 0 ]]; then
  echo "[!!] $errors error lines — investigate before declaring deploy healthy"
  exit 1
fi
echo "[OK] Deploy looks healthy."
