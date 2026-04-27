#!/usr/bin/env bash
set -euo pipefail

export AI_PROXY_URL="${AI_PROXY_URL:-http://localhost:8787}"
export AI_PROXY_TOKEN="${AI_PROXY_TOKEN:-proxy-managed}"

ai-proxy-tool-event session_start codex || true
trap 'ai-proxy-tool-event session_stop codex || true' EXIT

exec codex --config 'model_provider="company_proxy"' "$@"
