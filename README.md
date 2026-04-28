# AI API Logging Proxy

A Node.js/TypeScript intermediary for routing OpenAI and Anthropic API calls through a controlled service that logs request metadata, response metadata, streaming output, token usage, latency, and attribution fields for coaching AI users on token efficiency.

It also includes a tooling-capture layer for developer assistants such as Claude Code and Codex. Use provider base URL routing where supported, and send normalized CLI/desktop session events to `POST /tool-events` when raw provider traffic is not enough.

This starter is intentionally provider-transparent: it forwards provider-shaped requests and streams provider-shaped responses back to the client, while observing the side channel for audit and analytics.

## Why this shape

OpenAI streaming uses server-sent events for streaming responses, and streaming usage is available from final response events or usage-bearing chunks depending on endpoint and options, so the proxy preserves the raw SSE stream while parsing events for analytics ([OpenAI API reference](https://platform.openai.com/docs/api-reference/chat-streaming/streaming)).

Anthropic Messages streaming emits named events such as `message_start`, `content_block_delta`, `message_delta`, and `message_stop`, with cumulative usage appearing in stream events, so the proxy has a separate Anthropic observer instead of trying to normalize the wire protocol before returning it to clients ([Anthropic streaming docs](https://docs.anthropic.com/en/api/messages-streaming)).

Anthropic requests should include an `anthropic-version` header, and this starter supplies `2023-06-01` by default if the client does not provide one ([Anthropic versioning docs](https://docs.anthropic.com/en/api/versioning)).

## Quick start

```bash
npm install
cp .env.example .env
# Edit .env and add provider keys
npm run dev
```

The server automatically loads `.env` from the project root. A minimal local file looks like:

```dotenv
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
```

If you use `npm start`, rebuild after changing source:

```bash
npm run build
npm start
```

Health check:

```bash
curl http://localhost:8787/healthz
```

## Routing

Use the proxy base URL instead of the provider base URL:

| Provider | Client base URL |
| --- | --- |
| OpenAI | `http://localhost:8787/openai/v1` |
| Anthropic | `http://localhost:8787/anthropic/v1` |

Developer-tool setup:

| Tool | Capture method |
| --- | --- |
| Codex CLI / IDE | Configure `~/.codex/config.toml` to use `base_url = "https://proxy.company.com/openai/v1"`. |
| Claude Code CLI / IDE | Configure `ANTHROPIC_BASE_URL="https://proxy.company.com/anthropic"` through shell, `~/.claude/settings.json`, or IDE extension environment variables. |
| Claude Code Desktop / subscription flows | Use hooks or wrapper scripts to send normalized lifecycle/tool events to `POST /tool-events`; provider interception may depend on how the app authenticates. |

See [`TOOLING.md`](./TOOLING.md) for Claude Code and Codex setup.

Examples:

```bash
curl http://localhost:8787/openai/v1/chat/completions \
  -H 'content-type: application/json' \
  -d '{
    "model": "gpt-4o-mini",
    "stream": true,
    "stream_options": { "include_usage": true },
    "messages": [{ "role": "user", "content": "Say hello in five words." }]
  }'
```

```bash
curl http://localhost:8787/anthropic/v1/messages \
  -H 'content-type: application/json' \
  -H 'anthropic-version: 2023-06-01' \
  -d '{
    "model": "claude-3-5-haiku-latest",
    "max_tokens": 128,
    "stream": true,
    "messages": [{ "role": "user", "content": "Say hello in five words." }]
  }'
```

## SDK configuration

OpenAI JavaScript SDK:

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  apiKey: 'not-used-by-proxy',
  baseURL: 'http://localhost:8787/openai/v1'
});
```

Anthropic JavaScript SDK:

```ts
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: 'not-used-by-proxy',
  baseURL: 'http://localhost:8787/anthropic'
});
```

If you set `PROXY_SHARED_SECRET`, clients must send `Authorization: Bearer <secret>` to the proxy. The proxy strips client `Authorization` before forwarding and injects the real provider key server-side.

## Attribution headers

Add these headers from internal tools so usage can be grouped for coaching:

```text
x-ai-user-id: employee email, SSO subject, or internal user id
x-ai-team-id: group, department, project, or cost center
x-ai-app-id: app/workflow name, IDE extension, bot, or automation id
```

The same `user` field in OpenAI request bodies is also captured when present.

## Audit output

The default logger writes JSONL files under `logs/ai-api-YYYY-MM-DD.jsonl`.

Tooling events are written under `logs/ai-tool-events-YYYY-MM-DD.jsonl`.

Representative record:

```json
{
  "id": "proxy_request_id",
  "timestamp": "2026-04-27T22:17:00.000Z",
  "provider": "openai",
  "method": "POST",
  "path": "/v1/chat/completions",
  "model": "gpt-4o-mini",
  "stream": true,
  "status_code": 200,
  "provider_request_id": "req_...",
  "duration_ms": 1234,
  "first_token_ms": 350,
  "user_id": "employee@example.com",
  "team_id": "regulatory-writing",
  "app_id": "internal-drafting-tool",
  "usage": {
    "input_tokens": 1000,
    "output_tokens": 250,
    "total_tokens": 1250,
    "cached_tokens": 600,
    "reasoning_tokens": 0
  }
}
```

## Content logging

By default, this starter logs content shape and reconstructed response text, but it does not log raw prompts unless `LOG_RAW_CONTENT=true`.

For a regulated or enterprise environment, treat raw prompt and completion logging as sensitive:

- Default to metadata-only logging unless coaching requires content review.
- Add field-level redaction for emails, names, study identifiers, compound identifiers, PHI, API keys, and credentials.
- Encrypt logs at rest and restrict access by least privilege.
- Separate raw-content retention from usage-metrics retention.
- Consider storing raw content in object storage with short TTL and writing only hashes or pointers to the analytics database.
- Capture consent or acceptable-use notice for employees if prompt review is part of coaching.

## Analytics schema

Use JSONL only for development. For production, write to Postgres, BigQuery, Snowflake, or your internal lakehouse.

Suggested fact table:

```sql
create table ai_request_log (
  id text primary key,
  ts timestamptz not null,
  provider text not null,
  model text,
  user_id text,
  team_id text,
  app_id text,
  path text,
  stream boolean,
  status_code int,
  provider_request_id text,
  duration_ms int,
  first_token_ms int,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  cached_tokens int,
  reasoning_tokens int,
  request_bytes int,
  response_bytes int,
  request_summary jsonb,
  response_summary jsonb,
  error jsonb
);
```

Useful coaching metrics:

| Metric | Why it matters |
| --- | --- |
| Input tokens per successful output token | Finds copy-pasted context bloat. |
| Repeated prefix/cacheable tokens | Shows where prompt caching or templates can help. |
| Output tokens by task type | Finds missing `max_tokens` or overbroad asks. |
| Error and retry rate | Shows waste caused by invalid schemas, context overflow, or rate limits. |
| First-token latency by model and app | Helps users select model tiers appropriately. |
| Tool count and tool-result size | Finds expensive retrieval/tool patterns. |
| Conversation turn depth | Identifies tasks that should become reusable workflows. |
| Dependency-loop signals | Flags Claude Code/Codex sessions repeatedly deleting `node_modules` and `package-lock.json`, rerunning `npm install`, or polling too often while waiting. |

## Production hardening checklist

- Put the proxy behind SSO or mTLS, not a shared static secret.
- Use per-user or per-app budgets and rate limits before forwarding to providers.
- Store provider keys in a secret manager.
- Stream directly without buffering the full response; only parse chunks for analytics.
- Add backpressure-aware persistence by sending log events to a queue.
- Add DLP/redaction before any raw-content persistence.
- Add a retention policy by data class: metrics, redacted text, raw text, errors.
- Preserve provider request IDs for support investigations.
- Include OpenTelemetry trace IDs so proxy logs can be joined to application logs.
- Build a replay-safe mode that stores request hashes rather than raw prompts for high-sensitivity workflows.

## Current limitations

- This starter handles JSON request bodies. Multipart file endpoints need separate streaming upload handling.
- It logs reconstructed text output but not structured tool-call arguments by default.
- It does not yet implement per-user rate limiting or budget enforcement.
- It does not include a dashboard; use the emitted JSONL or database sink as the source.
- It does not transform request or response schemas; it is intended as a transparent proxy.
