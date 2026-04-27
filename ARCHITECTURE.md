# Architecture Notes

## Core pattern

The proxy is a transparent provider gateway:

1. Client sends a normal OpenAI or Anthropic request to the proxy.
2. Proxy authenticates the caller.
3. Proxy injects the upstream provider API key.
4. Proxy forwards the request body and provider-relevant headers.
5. Proxy streams the upstream response to the client immediately.
6. Proxy parses a copy of each response chunk for logging and analytics.
7. Proxy writes one audit event after completion or failure.

For developer tools, the proxy adds a second event plane:

1. Codex or Claude Code is configured to route model requests through the provider gateway when possible.
2. Wrapper scripts or hooks send lifecycle and local-context events to `POST /tool-events`.
3. Tool events are written separately from provider request logs so you can join them by user, team, app, session, repo, and timestamp.

This avoids breaking SDK streaming behavior and keeps provider-specific event formats intact.

## Route layout

```text
POST /openai/v1/chat/completions  -> https://api.openai.com/v1/chat/completions
POST /openai/v1/responses         -> https://api.openai.com/v1/responses
POST /anthropic/v1/messages       -> https://api.anthropic.com/v1/messages
POST /tool-events                 -> normalized Claude Code / Codex / wrapper events
GET  /tooling/config              -> generated setup snippets
```

The wildcard route means most JSON endpoints work without new route handlers.

## Streaming

The implementation does not buffer the full stream before returning data. It writes each upstream chunk to the client and separately feeds that same chunk to a provider-specific observer.

OpenAI observer:

- Parses `data:` SSE records.
- Captures `response.output_text.delta` events for the Responses API.
- Captures `choices[0].delta.content` for Chat Completions.
- Extracts final usage when present.

Anthropic observer:

- Parses named SSE events.
- Captures `content_block_delta` events with `text_delta`.
- Updates usage from `message_start` and `message_delta`.
- Notes thinking deltas without storing reasoning text.

## Logging levels

Recommended production modes:

| Mode | Prompt content | Completion content | Use case |
| --- | --- | --- | --- |
| Metrics only | No | No | Organization-wide monitoring. |
| Redacted coaching | Redacted excerpts | Redacted excerpts | User coaching and prompt improvement. |
| Raw forensic | Yes, encrypted | Yes, encrypted | Short-retention incident review only. |

This starter defaults toward safer logging by summarizing request shape unless `LOG_RAW_CONTENT=true`.

## Production storage

JSONL is useful for development, but production should use a durable sink:

- Kafka or SQS for ingestion buffering.
- Postgres for straightforward dashboards.
- Snowflake or BigQuery for large-scale analytics.
- Object storage for encrypted raw prompt/response payloads with strict retention.

## Coaching workflow

Useful coaching reports:

- Top users and apps by total tokens.
- High input-token requests with low output-token value.
- Prompts repeatedly sending static context without cache controls.
- Workflows with excessive retry/error rates.
- Teams using expensive models for low-complexity classification or extraction.
- Requests with no output cap or very high output cap.
- Latency and cost differences by model for similar task classes.

## Important implementation cautions

- Do not mutate request or response payloads unless you intentionally want to become an API compatibility layer.
- Do not parse stream chunks by assuming one chunk equals one SSE event.
- Do not rely only on local token estimation when providers return authoritative usage.
- Do not store raw prompts from regulated workflows without legal, security, privacy, and records-management review.
- Do not let the proxy become an open relay; authenticate every caller.
