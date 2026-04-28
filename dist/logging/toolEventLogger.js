import { getDb } from '../db/database.js';
import { redactJson } from '../utils/redact.js';
export class ToolEventLogger {
    async write(record) {
        const safe = redactJson(record);
        getDb().prepare(`
      INSERT OR REPLACE INTO ai_tool_events
        (id, ts, tool, event_type, user_id, team_id, app_id,
         session_id, conversation_id, cwd, repo, model, provider,
         prompt_summary, response_summary, usage, metadata, coaching_signals)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(safe.id, safe.timestamp, safe.tool, safe.event_type, safe.user_id || null, safe.team_id || null, safe.app_id || null, safe.session_id || null, safe.conversation_id || null, safe.cwd || null, safe.repo || null, safe.model || null, safe.provider || null, safe.prompt_summary != null ? JSON.stringify(safe.prompt_summary) : null, safe.response_summary != null ? JSON.stringify(safe.response_summary) : null, safe.usage != null ? JSON.stringify(safe.usage) : null, safe.metadata != null ? JSON.stringify(safe.metadata) : null, safe.coaching_signals?.length ? JSON.stringify(safe.coaching_signals) : null);
    }
}
export const toolEventLogger = new ToolEventLogger();
