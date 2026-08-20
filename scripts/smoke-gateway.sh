#!/usr/bin/env bash
# Live gateway checks. No iOS Simulator. No TestFlight.
set -euo pipefail

BASE="${OPENZOO_GATEWAY:-https://x402-tokens.fly.dev}"

echo "== GET ${BASE}/v1/stats =="
curl -fsS "${BASE}/v1/stats" -o /tmp/openzoo-stats.json
python3 - <<'PY'
import json
with open("/tmp/openzoo-stats.json", encoding="utf-8") as fh:
    data = json.load(fh)
if not isinstance(data, dict):
    raise SystemExit("stats: expected a JSON object")
print("stats: valid JSON")
print("app:", data.get("app"))
print("keys:", ", ".join(sorted(data.keys())))
PY

echo
echo "== GET ${BASE}/v1/models =="
curl -fsS "${BASE}/v1/models" -o /tmp/openzoo-models.json
python3 - <<'PY'
import json
with open("/tmp/openzoo-models.json", encoding="utf-8") as fh:
    data = json.load(fh)
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
