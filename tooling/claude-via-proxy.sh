#!/usr/bin/env bash
set -euo pipefail

export AI_PROXY_URL="${AI_PROXY_URL:-http://localhost:8787}"
export ANTHROPIC_BASE_URL="${AI_PROXY_URL%/}/anthropic"
export ANTHROPIC_API_KEY="${AI_PROXY_TOKEN:-proxy-managed}"
export ANTHROPIC_CUSTOM_HEADERS='{"x-ai-app-id":"claude-code"}'

ai-proxy-tool-event session_start claude-code || true
trap 'ai-proxy-tool-event session_stop claude-code || true' EXIT

exec claude "$@"
