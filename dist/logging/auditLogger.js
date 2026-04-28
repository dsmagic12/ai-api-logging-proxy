import { getDb } from '../db/database.js';
import { redactJson } from '../utils/redact.js';
export class AuditLogger {
    async write(record) {
        const safe = redactJson(record);
        const usage = safe.usage ?? {};
        getDb().prepare(`
      INSERT OR REPLACE INTO ai_request_log
        (id, ts, provider, method, path, model, stream, status_code, ok,
         user_id, team_id, app_id, provider_request_id,
         duration_ms, first_token_ms,
         input_tokens, output_tokens, total_tokens, cached_tokens, reasoning_tokens,
         request_bytes, response_bytes, request_summary, response_summary, error)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(safe.id, safe.timestamp, safe.provider, safe.method ?? null, safe.path ?? null, safe.model ?? null, safe.stream ? 1 : 0, safe.status_code ?? null, safe.ok ? 1 : 0, safe.user_id || null, safe.team_id || null, safe.app_id || null, safe.provider_request_id ?? null, safe.duration_ms ?? null, safe.first_token_ms ?? null, usage.input_tokens ?? null, usage.output_tokens ?? null, usage.total_tokens ?? null, usage.cached_tokens ?? null, usage.reasoning_tokens ?? null, safe.request_bytes ?? null, safe.response_bytes ?? null, safe.request_summary != null ? JSON.stringify(safe.request_summary) : null, safe.response_summary != null ? JSON.stringify(safe.response_summary) : null, safe.error != null ? JSON.stringify(safe.error) : null);
    }
}
export const auditLogger = new AuditLogger();
