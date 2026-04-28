# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install          # Install deps (includes native better-sqlite3 addon)
npm run dev          # Start with hot reload (tsx watch)
npm run build        # Compile TypeScript + copy public/ to dist/
npm start            # Run compiled output (requires build first)
npm run check        # Type-check without emitting
```

Environment: copy `.env.local` to `.env` and fill in provider keys before running.

Health check: `curl http://localhost:8787/healthz`

There is no test suite. Type-checking (`npm run check`) is the primary static correctness gate.

## Architecture

The proxy is a **transparent provider gateway** built on Fastify. Requests flow in provider-native shape, are forwarded upstream via `undici`, and streamed back to the client without buffering the full response. A side-channel observer parses each chunk for logging, which is persisted to SQLite.

### Request lifecycle (`src/providers/proxy.ts`)

1. `proxyProviderRequest` builds an `AuditRecord`, forwards the request via `undici`, and copies upstream response headers directly to `reply.raw`.
2. If the response is SSE / streaming: `streamWithObservation` pipes upstream body → client while feeding each `Buffer` to a `StreamObserver`. The observer accumulates text and usage without blocking the stream.
3. After the stream ends (or on error), one audit record is written by `AuditLogger` to SQLite.

### Provider observers (`src/providers/`)

`OpenAIStreamObserver` and `AnthropicStreamObserver` both implement `StreamObserver` (defined in `src/types.ts`). They buffer incomplete SSE chunks across calls and parse complete `\n\n`-delimited events. They are **not** interchangeable—Anthropic SSE uses named `event:` lines and provider-specific event types; OpenAI uses only `data:` lines and two wire shapes (Chat Completions and Responses API).

### SQLite persistence (`src/db/`)

`database.ts` initializes a single `better-sqlite3` instance in WAL mode, creates both tables and their indexes on first run, and exports `getDb()` as a lazy singleton. The DB file is at `${LOG_DIR}/ai-proxy.db` (default `./logs/ai-proxy.db`).

`queries.ts` exposes three query functions used by the API routes:
- `queryLogs(params)` — filterable, paginated reads from `ai_request_log`
- `queryToolEvents(params)` — filterable, paginated reads from `ai_tool_events`
- `queryStats()` — aggregate totals, per-provider and per-model counts

Both tables store JSON columns (request_summary, response_summary, usage, metadata, coaching_signals, etc.) as serialized strings. `queryLogs`/`queryToolEvents` parse these back to objects before returning.

`better-sqlite3` uses a **synchronous** API. DB writes happen in the `finally` block of `proxyProviderRequest` and in the `POST /tool-events` handler, both after the response is sent. DB reads in `/api/*` handlers block the event loop briefly — acceptable for an owner-facing dashboard with low concurrency.

### Logging (`src/logging/`)

`AuditLogger` and `ToolEventLogger` both call `redactJson` before writing to SQLite. They use `INSERT OR REPLACE` so duplicate IDs (from retries) overwrite rather than error. Unlike the old JSONL implementation, the DB file path does not rotate daily — a single file accumulates all records.

### Redaction (`src/utils/redact.ts`)

`redactString` applies regex substitutions for OpenAI keys, Anthropic keys, Bearer tokens, and email addresses, then truncates to `MAX_LOGGED_CHARS`. `redactJson` round-trips through JSON to apply string redaction to every leaf. `summarizeRequestBody` produces a shape-only summary (message count, roles, char count) unless `LOG_RAW_CONTENT=true`.

### Tool event plane (`src/tooling/`)

`POST /tool-events` accepts normalized events from Claude Code hooks, wrapper scripts, or Codex. `dependencyLoopDetector.ts` maintains in-process session state (a `Map` keyed by `tool|user|session|repo`) and emits `CoachingSignal[]` when it detects npm reinstall loops or excessive polling within rolling 30-minute windows.

`GET /tooling/config` returns generated setup snippets (Codex TOML, Claude Code settings JSON, shell wrappers) with the proxy base URL interpolated.

## Key conventions

**ESM with `.js` imports**: The project uses `"type": "module"` and `"moduleResolution": "NodeNext"`. All internal imports must use `.js` extensions even though the source files are `.ts`. This is standard NodeNext TypeScript—do not add `.ts` extensions.

**Route auth**: A `preHandler` hook calls `proxyAuth` on all routes except `/`, `/public/*`, `/api/*`, `/demo/*`, `/tooling/config`, and `/healthz`. Auth is skipped entirely when `PROXY_SHARED_SECRET` is empty.

**Header forwarding**: `buildForwardHeaders` strips hop-by-hop headers and the client `Authorization`, then injects the real provider key server-side. Anthropic requests get `x-api-key`; OpenAI requests get `Authorization: Bearer`. The `anthropic-version` header is passed through if present, otherwise defaulted from config.

**Do not buffer streams**: The `streamWithObservation` pattern yields each chunk immediately. Observers must handle partial SSE events across `onChunk` calls using their internal `buffer` string.

**Two log tables are separate**: Provider request logs (`ai_request_log`) and tool event logs (`ai_tool_events`) live in different tables with different schemas. Do not conflate them.

**Config is loaded once at import**: `src/config.ts` reads `process.env` at module load time via `dotenv/config`. Tests or scripts that mutate env vars after startup will not see changes in `config`.

## Route layout

```
GET  /healthz                  Health check (no auth)
GET  /                         Dashboard UI (no auth)
GET  /public/:asset            Static assets (no auth)
GET  /api/stats                Aggregate metrics from SQLite (no auth)
GET  /api/logs                 Paginated query of ai_request_log (no auth)
GET  /api/tool-events          Paginated query of ai_tool_events (no auth)
GET  /demo/logs                Static demo records (no auth)
GET  /demo/stream              Demo SSE stream (no auth)
POST /demo/dependency-loop     Trigger demo loop detection (no auth)
GET  /tooling/config           Generated setup snippets (no auth)
POST /tool-events              Ingest Claude Code / Codex events (auth if secret set)
POST /openai/v1/*              Proxy to OpenAI (auth if secret set)
POST /anthropic/v1/*           Proxy to Anthropic (auth if secret set)
```

### Query parameters for `/api/logs`

| Param | Description |
|---|---|
| `provider` | `openai` or `anthropic` |
| `model` | exact model name |
| `user_id`, `team_id`, `app_id` | exact match |
| `search` | LIKE match across model, user_id, team_id, app_id |
| `from`, `to` | ISO date strings (`YYYY-MM-DD` or full ISO) |
| `limit` | default 50, max 500 |
| `offset` | default 0 |

### Query parameters for `/api/tool-events`

Same as above plus `tool` (`claude-code`/`codex`), `event_type`, and `session_id`.

## Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8787` | Listening port |
| `LOG_DIR` | `./logs` | SQLite DB directory (`ai-proxy.db` inside) |
| `LOG_RAW_CONTENT` | `false` | Include prompt/completion text in logs |
| `MAX_LOGGED_CHARS` | `12000` | Truncation limit for string redaction |
| `PROXY_SHARED_SECRET` | _(none)_ | If set, require `Authorization: Bearer <secret>` |
| `OPENAI_API_KEY` | _(none)_ | Injected server-side for OpenAI requests |
| `ANTHROPIC_API_KEY` | _(none)_ | Injected server-side for Anthropic requests |
| `OPENAI_BASE_URL` | `https://api.openai.com` | Upstream override |
| `ANTHROPIC_BASE_URL` | `https://api.anthropic.com` | Upstream override |
| `ANTHROPIC_VERSION` | `2023-06-01` | Default `anthropic-version` header |
