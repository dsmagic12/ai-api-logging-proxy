export function codexConfig(proxyBaseUrl) {
    const normalized = proxyBaseUrl.replace(/\/$/, '');
    return `# ~/.codex/config.toml
# CLI and IDE extension share this config.
model_provider = "company_proxy"
model = "gpt-5.4"

[model_providers.company_proxy]
name = "Company AI Proxy"
base_url = "${normalized}/openai/v1"
env_key = "AI_PROXY_TOKEN"
wire_api = "responses"

[model_providers.company_proxy.http_headers]
"x-ai-app-id" = "codex"

[model_providers.company_proxy.env_http_headers]
"x-ai-user-id" = "USER"
"x-ai-team-id" = "AI_PROXY_TEAM"
`;
}
export function claudeCodeSettings(proxyBaseUrl) {
    const normalized = proxyBaseUrl.replace(/\/$/, '');
    return `{
  "env": {
    "ANTHROPIC_BASE_URL": "${normalized}/anthropic",
    "ANTHROPIC_API_KEY": "set-via-secret-manager-or-shell",
    "ANTHROPIC_CUSTOM_HEADERS": "{\\"x-ai-app-id\\":\\"claude-code\\"}"
  },
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ai-proxy-tool-event session_start claude-code"
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "ai-proxy-tool-event session_stop claude-code"
          }
        ]
      }
    ]
  }
}`;
}
export function shellWrappers(proxyBaseUrl) {
    const normalized = proxyBaseUrl.replace(/\/$/, '');
    return `#!/usr/bin/env bash
# /usr/local/bin/claude-via-proxy
export ANTHROPIC_BASE_URL="${normalized}/anthropic"
export ANTHROPIC_API_KEY="\${AI_PROXY_TOKEN:-proxy-managed}"
export ANTHROPIC_CUSTOM_HEADERS='{"x-ai-app-id":"claude-code"}'
exec claude "$@"

#!/usr/bin/env bash
# /usr/local/bin/codex-via-proxy
export AI_PROXY_TOKEN="\${AI_PROXY_TOKEN:-proxy-managed}"
exec codex --config 'model_provider="company_proxy"' "$@"
`;
}
