#!/usr/bin/env bash
# Live gateway checks. No iOS Simulator. No TestFlight.
set -euo pipefail

BASE="${OPENZOO_GATEWAY:-https://x402-tokens.fly.dev}"

echo "== GET ${BASE}/v1/stats =="
STATS="$(curl -fsS "${BASE}/v1/stats")"
python3 - <<'PY' <<<"$STATS"
import json, sys
data = json.loads(sys.stdin.read())
if not isinstance(data, dict):
    raise SystemExit("stats: expected a JSON object")
print("stats: valid JSON")
print("app:", data.get("app"))
print("keys:", ", ".join(sorted(data.keys())))
PY

echo
echo "== GET ${BASE}/v1/models =="
MODELS="$(curl -fsS "${BASE}/v1/models")"
python3 - <<'PY' <<<"$MODELS"
import json, sys
data = json.loads(sys.stdin.read())
rows = data.get("data") if isinstance(data, dict) else data
if not isinstance(rows, list) or not rows:
    raise SystemExit("models: expected a non-empty data list")
ids = [row.get("id") for row in rows if isinstance(row, dict)]
print("models: valid JSON, count=%d" % len(ids))
print("default openai/gpt-4o-mini present:", "openai/gpt-4o-mini" in ids)
if "openai/gpt-4o-mini" not in ids:
    raise SystemExit("models: openai/gpt-4o-mini was not in the live list")
PY

echo
echo "smoke-gateway: ok"
