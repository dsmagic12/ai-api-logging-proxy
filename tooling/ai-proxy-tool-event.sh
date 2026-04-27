#!/usr/bin/env bash
set -euo pipefail

EVENT_TYPE="${1:-heartbeat}"
TOOL="${2:-unknown}"
COMMAND="${AI_PROXY_COMMAND:-${3:-}}"
PROXY_URL="${AI_PROXY_URL:-http://localhost:8787}"

payload="$(
  TOOL="${TOOL}" \
  EVENT_TYPE="${EVENT_TYPE}" \
  SESSION_ID="${CLAUDE_SESSION_ID:-${CODEX_SESSION_ID:-}}" \
  CWD="${PWD}" \
  REPO="$(git config --get remote.origin.url 2>/dev/null || true)" \
  COMMAND="${COMMAND}" \
  SHELL_NAME="${SHELL:-}" \
  LOCAL_USER="${USER:-${USERNAME:-}}" \
  python3 - <<'PY'
import json
import os

payload = {
  "tool": os.environ["TOOL"],
  "event_type": os.environ["EVENT_TYPE"],
  "session_id": os.environ["SESSION_ID"],
  "cwd": os.environ["CWD"],
  "repo": os.environ["REPO"],
  "source": "shell-hook",
  "metadata": {
    "shell": os.environ["SHELL_NAME"],
    "user": os.environ["LOCAL_USER"]
  }
}
command = os.environ["COMMAND"]
if command:
  payload["command"] = command
  payload["metadata"]["command"] = command
print(json.dumps(payload))
PY
)"

curl -fsS "${PROXY_URL%/}/tool-events" \
  -H 'content-type: application/json' \
  -H "authorization: Bearer ${AI_PROXY_TOKEN:-}" \
  -H "x-ai-user-id: ${AI_PROXY_USER_ID:-${USER:-${USERNAME:-}}}" \
  -H "x-ai-team-id: ${AI_PROXY_TEAM_ID:-}" \
  -H "x-ai-app-id: ${TOOL}" \
  --data "${payload}" >/dev/null || true
