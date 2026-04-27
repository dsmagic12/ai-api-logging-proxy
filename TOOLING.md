# Capturing Claude Code and Codex

The proxy supports two complementary capture modes for developer tools:

1. **Provider API interception**: point the tool at the proxy as its provider base URL, so model requests and streaming responses pass through `/openai/v1/*` or `/anthropic/v1/*`.
2. **Tool event ingestion**: send normalized session, prompt, tool-use, command, file-edit, and error events to `POST /tool-events`.

Use both where possible. Provider interception gives authoritative usage and streaming details. Tool events provide CLI/desktop context that raw provider API calls often do not include, such as repo, working directory, session lifecycle, command execution, and app identity.

## Codex

Codex has first-class configuration for an OpenAI-compatible proxy. Personal config lives at `~/.codex/config.toml`, project overrides can live in `.codex/config.toml`, and the CLI and IDE extension share those layers ([OpenAI Codex config basics](https://developers.openai.com/codex/config-basic)).

Codex supports `openai_base_url` for the built-in OpenAI provider, and custom providers under `[model_providers.<id>]` with `base_url`, `env_key`, `http_headers`, `env_http_headers`, and `wire_api` ([OpenAI Codex advanced configuration](https://developers.openai.com/codex/config-advanced)).

Recommended config:

```toml
model_provider = "company_proxy"
model = "gpt-5.4"

[model_providers.company_proxy]
name = "Company AI Proxy"
base_url = "https://proxy.company.com/openai/v1"
env_key = "AI_PROXY_TOKEN"
wire_api = "responses"

[model_providers.company_proxy.http_headers]
"x-ai-app-id" = "codex"

[model_providers.company_proxy.env_http_headers]
"x-ai-user-id" = "AI_PROXY_USER_ID"
"x-ai-team-id" = "AI_PROXY_TEAM_ID"
```

For a single run:

```bash
codex --config 'model_provider="company_proxy"'
```

To generate snippets from the running proxy:

```bash
curl "http://localhost:8787/tooling/config?proxy_base_url=https://proxy.company.com"
```

## Claude Code

Claude Code settings are shared between CLI and the VS Code extension through `~/.claude/settings.json`, including allowed commands, environment variables, hooks, and MCP servers ([Claude Code IDE integration docs](https://docs.anthropic.com/en/docs/claude-code/ide-integrations)).

Claude Code hooks run shell commands before or after Claude Code actions, which makes them useful for recording session lifecycle and local tool context ([Claude Code overview](https://docs.anthropic.com/claude-code)).

Recommended environment routing:

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://proxy.company.com/anthropic",
    "ANTHROPIC_API_KEY": "set-via-secret-manager-or-shell",
    "ANTHROPIC_CUSTOM_HEADERS": "{\"x-ai-app-id\":\"claude-code\"}"
  }
}
```

VS Code extension setting alternative:

```json
{
  "claude-code.environmentVariables": [
    { "name": "ANTHROPIC_BASE_URL", "value": "https://proxy.company.com/anthropic" },
    { "name": "ANTHROPIC_API_KEY", "value": "set-via-secret-manager-or-shell" },
    { "name": "ANTHROPIC_CUSTOM_HEADERS", "value": "{\"x-ai-app-id\":\"claude-code\"}" }
  ]
}
```

Suggested hooks:

```json
{
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
}
```

## Wrapper scripts

Install the helper scripts from `tooling/`:

```bash
install -m 0755 tooling/ai-proxy-tool-event.sh /usr/local/bin/ai-proxy-tool-event
install -m 0755 tooling/claude-via-proxy.sh /usr/local/bin/claude-via-proxy
install -m 0755 tooling/codex-via-proxy.sh /usr/local/bin/codex-via-proxy
```

Set environment:

```bash
export AI_PROXY_URL="https://proxy.company.com"
export AI_PROXY_TOKEN="issued-by-your-proxy-or-secret-manager"
export AI_PROXY_USER_ID="employee@company.com"
export AI_PROXY_TEAM_ID="regulatory-writing"
```

Run:

```bash
claude-via-proxy
codex-via-proxy
```

## Event ingestion API

Endpoint:

```http
POST /tool-events
content-type: application/json
authorization: Bearer <proxy token>
x-ai-user-id: employee@company.com
x-ai-team-id: regulatory-writing
x-ai-app-id: claude-code
```

Example:

```json
{
  "tool": "claude-code",
  "event_type": "session_start",
  "session_id": "local-session-id",
  "cwd": "/Users/alex/repo",
  "repo": "git@github.com:company/repo.git",
  "model": "claude-sonnet-4-5",
  "metadata": {
    "source": "shell-wrapper"
  }
}
```

Events are written to `logs/ai-tool-events-YYYY-MM-DD.jsonl`.

### Command events

For Claude Code and Codex loop detection, send command events with the shell command in either `command` or `metadata.command`:

```json
{
  "tool": "codex",
  "event_type": "command",
  "session_id": "local-session-id",
  "cwd": "/Users/alex/repo",
  "repo": "git@github.com:company/repo.git",
  "command": "rm -rf node_modules package-lock.json && npm install"
}
```

The included helper accepts the command as a third argument, or through `AI_PROXY_COMMAND`:

```bash
ai-proxy-tool-event command claude-code 'rm -rf node_modules package-lock.json && npm install'
AI_PROXY_COMMAND='ps aux | grep npm' ai-proxy-tool-event command codex
```

The proxy watches each user/tool/session/repo window for dependency-loop patterns and annotates matching events with `coaching_signals`.

Detected patterns:

| Signal | Pattern | Recommendation |
| --- | --- | --- |
| `npm_dependency_reinstall_loop` | Repeated `node_modules` deletion, `package-lock.json` deletion, and `npm install` in the same 30-minute session window. | Stop reinstalling dependencies; inspect the first npm error and fix the actual package constraint or environment issue. |
| `npm_install_retry_loop` | Three or more `npm install` attempts in 30 minutes. | Do not retry without changing the cause; capture and summarize the failure once. |
| `package_lock_churn` | Repeated lockfile deletion. | Prefer `npm ci` or a single intentional lockfile update after resolving constraints. |
| `excessive_command_polling` | Five or more process/status polling commands in five minutes. | Wait for completion, stream output once, or use a longer interval rather than repeatedly checking. |

You can exercise the detector locally:

```bash
curl -X POST http://localhost:8787/demo/dependency-loop \
  -H 'content-type: application/json' \
  -d '{"tool":"claude-code"}'
```

## Limits and caveats

- Claude Code Desktop or subscription-backed flows may not always expose every raw provider request. Use tool events and hooks to capture context even when provider interception is unavailable.
- CLI wrappers can capture lifecycle and environment context, but they should not log raw prompts by default.
- Provider API interception remains the best source for authoritative token usage.
- Avoid collecting raw code, prompts, or command outputs without a clear retention and employee notice policy.
