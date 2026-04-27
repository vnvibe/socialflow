#!/usr/bin/env bash
#
# Deploy script for the anti-detect pipeline (PR0 + PR2 + PR3, 2026-04-25).
#
# Run on the VPS that hosts socialflow-api + hermes-api.
# Usage:   bash deploy-antidetect.sh
#
# Prerequisites on VPS:
#   • git pull already done in both repos
#   • AGENT_SECRET env var exported in the shell or available in api/.env
#   • pm2 running socialflow-api + hermes-api (or python process for hermes)
#   • node >= 18

set -euo pipefail

# ── Paths (edit if your VPS layout differs) ──────────────────────
SOCIALFLOW_DIR="${SOCIALFLOW_DIR:-/root/socialflow}"
HERMES_DIR="${HERMES_DIR:-/root/hermes-api}"
API_DIR="$SOCIALFLOW_DIR/api"
HERMES_URL="${HERMES_URL:-http://127.0.0.1:8100}"
PM2_API_NAME="${PM2_API_NAME:-socialflow-api}"
PM2_HERMES_NAME="${PM2_HERMES_NAME:-hermes-api}"

# Load AGENT_SECRET from api/.env if not already exported
if [[ -z "${AGENT_SECRET:-}" ]]; then
  if [[ -f "$API_DIR/.env" ]]; then
    AGENT_SECRET=$(grep -E '^AGENT_SECRET(_KEY)?=' "$API_DIR/.env" | head -1 | cut -d= -f2- | tr -d '"')
  fi
fi
if [[ -z "${AGENT_SECRET:-}" ]]; then
  echo "[ERROR] AGENT_SECRET not set and not found in $API_DIR/.env" >&2
  exit 1
fi

echo "=== SocialFlow Anti-Detect Pipeline Deploy ==="
echo "  socialflow:   $SOCIALFLOW_DIR"
echo "  hermes-api:   $HERMES_DIR"
echo "  hermes URL:   $HERMES_URL"
echo

# ── 1. Verify new skill files are on disk ────────────────────────
echo "[1/5] Verifying new skill files…"
for skill in checkpoint-predictor traffic-conductor social-graph-spreader orchestrator; do
  f="$HERMES_DIR/skills/$skill.md"
  if [[ ! -f "$f" ]]; then
    echo "  [ERROR] Missing $f — did you git pull?" >&2
    exit 1
  fi
  size=$(stat -c%s "$f" 2>/dev/null || stat -f%z "$f")
  echo "  ✓ $skill ($size bytes)"
done

# ── 2. Reload Hermes skills (hot-reload, no restart needed) ─────
echo
echo "[2/5] Reloading Hermes skills…"
RELOAD_RESPONSE=$(curl -sS -X POST -H "X-Agent-Key: $AGENT_SECRET" "$HERMES_URL/skills/reload" || true)
if echo "$RELOAD_RESPONSE" | grep -q "skills_loaded"; then
  echo "  ✓ Reload OK: $(echo "$RELOAD_RESPONSE" | head -c 200)"
else
  echo "  [WARN] Reload response unexpected: $RELOAD_RESPONSE"
  echo "  [WARN] Falling back to pm2 restart hermes…"
  pm2 restart "$PM2_HERMES_NAME" || true
fi

# ── 3. Sanity-check: each new skill is reachable via /skills/<name> ─
echo
echo "[3/5] Verifying skills loaded into Hermes runtime…"
for skill in checkpoint_predictor traffic_conductor social_graph_spreader orchestrator; do
  status=$(curl -sS -o /dev/null -w "%{http_code}" -H "X-Agent-Key: $AGENT_SECRET" "$HERMES_URL/skills/$skill")
  if [[ "$status" == "200" ]]; then
    echo "  ✓ $skill loaded"
  else
    echo "  [ERROR] $skill returned HTTP $status — Hermes did not pick it up" >&2
    exit 1
  fi
done

# ── 4. Restart api (loads new hermes-orchestrator.js + nick-autopilot/kpi-watcher) ─
echo
echo "[4/5] Restarting socialflow-api…"
pm2 restart "$PM2_API_NAME" --update-env
sleep 3
if pm2 describe "$PM2_API_NAME" | grep -q "online"; then
  echo "  ✓ socialflow-api online"
else
  echo "  [ERROR] socialflow-api not online — check pm2 logs $PM2_API_NAME" >&2
  exit 1
fi

# ── 5. Seed personas (idempotent — safe to re-run) ───────────────
echo
echo "[5/5] Seeding personas…"
cd "$API_DIR"
node seed-personas.js --dry | head -20
echo
read -p "Apply persona seeding? [y/N] " confirm
if [[ "$confirm" =~ ^[Yy]$ ]]; then
  node seed-personas.js
else
  echo "  Skipped persona seeding (run manually: cd $API_DIR && node seed-personas.js)"
fi

echo
echo "=== Deploy complete ==="
echo
echo "Next: monitor logs for 30 minutes. Use:"
echo "  bash $SOCIALFLOW_DIR/verify-antidetect.sh"
echo
echo "Kill switch (if pipeline misbehaves):"
echo "  pm2 set socialflow-api:HERMES_ANTIDETECT_DISABLED 1"
echo "  pm2 restart $PM2_API_NAME --update-env"
