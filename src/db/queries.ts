import { getDb } from './database.js';

export type LogQueryParams = {
  provider?: string;
  model?: string;
  user_id?: string;
  team_id?: string;
  app_id?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

export type ToolEventQueryParams = {
  tool?: string;
  event_type?: string;
  session_id?: string;
  user_id?: string;
  team_id?: string;
  from?: string;
  to?: string;
  search?: string;
  limit?: number;
  offset?: number;
};

function parseJsonColumn(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function parseRecord(row: Record<string, unknown>): Record<string, unknown> {
  const jsonCols = [
    'request_summary', 'response_summary', 'error',
    'usage', 'metadata', 'coaching_signals', 'prompt_summary'
  ];
  const out: Record<string, unknown> = { ...row };
  for (const col of jsonCols) {
    if (col in out) out[col] = parseJsonColumn(out[col]);
  }
  return out;
}

export function queryLogs(params: LogQueryParams): { records: unknown[]; total: number } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.provider) { conditions.push('provider = ?'); bindings.push(params.provider); }
  if (params.model) { conditions.push('model = ?'); bindings.push(params.model); }
  if (params.user_id) { conditions.push('user_id = ?'); bindings.push(params.user_id); }
  if (params.team_id) { conditions.push('team_id = ?'); bindings.push(params.team_id); }
  if (params.app_id) { conditions.push('app_id = ?'); bindings.push(params.app_id); }
  if (params.from) { conditions.push('ts >= ?'); bindings.push(params.from); }
  if (params.to) {
    const to = params.to.length === 10 ? `${params.to}T23:59:59.999Z` : params.to;
    conditions.push('ts <= ?'); bindings.push(to);
  }
  if (params.search) {
    const pat = `%${params.search}%`;
    conditions.push('(model LIKE ? OR user_id LIKE ? OR team_id LIKE ? OR app_id LIKE ?)');
    bindings.push(pat, pat, pat, pat);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(params.limit ?? 50, 500);
  const offset = params.offset ?? 0;
  const db = getDb();

  const records = db.prepare(
    `SELECT * FROM ai_request_log ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`
  ).all([...bindings, limit, offset]) as Record<string, unknown>[];

  const { n } = db.prepare(
    `SELECT COUNT(*) as n FROM ai_request_log ${where}`
  ).get([...bindings]) as { n: number };

  return { records: records.map(parseRecord), total: n };
}

export function queryToolEvents(params: ToolEventQueryParams): { records: unknown[]; total: number } {
  const conditions: string[] = [];
  const bindings: unknown[] = [];

  if (params.tool) { conditions.push('tool = ?'); bindings.push(params.tool); }
  if (params.event_type) { conditions.push('event_type = ?'); bindings.push(params.event_type); }
  if (params.session_id) { conditions.push('session_id = ?'); bindings.push(params.session_id); }
  if (params.user_id) { conditions.push('user_id = ?'); bindings.push(params.user_id); }
  if (params.team_id) { conditions.push('team_id = ?'); bindings.push(params.team_id); }
  if (params.from) { conditions.push('ts >= ?'); bindings.push(params.from); }
  if (params.to) {
    const to = params.to.length === 10 ? `${params.to}T23:59:59.999Z` : params.to;
    conditions.push('ts <= ?'); bindings.push(to);
  }
  if (params.search) {
    const pat = `%${params.search}%`;
    conditions.push('(tool LIKE ? OR session_id LIKE ? OR user_id LIKE ? OR repo LIKE ?)');
    bindings.push(pat, pat, pat, pat);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(params.limit ?? 50, 500);
  const offset = params.offset ?? 0;
  const db = getDb();

  const records = db.prepare(
    `SELECT * FROM ai_tool_events ${where} ORDER BY ts DESC LIMIT ? OFFSET ?`
  ).all([...bindings, limit, offset]) as Record<string, unknown>[];

  const { n } = db.prepare(
    `SELECT COUNT(*) as n FROM ai_tool_events ${where}`
  ).get([...bindings]) as { n: number };

  return { records: records.map(parseRecord), total: n };
}

export function queryStats() {
  const db = getDb();

  const totals = db.prepare(`
    SELECT
      COUNT(*) as total_requests,
      SUM(input_tokens) as total_input_tokens,
      SUM(output_tokens) as total_output_tokens,
      SUM(cached_tokens) as total_cached_tokens,
      AVG(duration_ms) as avg_duration_ms,
      AVG(first_token_ms) as avg_first_token_ms
    FROM ai_request_log
  `).get() as Record<string, number | null>;

  const byProvider = db.prepare(`
    SELECT provider, COUNT(*) as count
    FROM ai_request_log
    GROUP BY provider
    ORDER BY count DESC
  `).all() as { provider: string; count: number }[];

  const byModel = db.prepare(`
    SELECT model, COUNT(*) as count
    FROM ai_request_log
    WHERE model IS NOT NULL
    GROUP BY model
    ORDER BY count DESC
    LIMIT 10
  `).all() as { model: string; count: number }[];

  const { total: toolEventsTotal } = db.prepare(
    `SELECT COUNT(*) as total FROM ai_tool_events`
  ).get() as { total: number };

  const { total: coachingTotal } = db.prepare(
    `SELECT COUNT(*) as total FROM ai_tool_events WHERE coaching_signals IS NOT NULL`
  ).get() as { total: number };

  return {
    total_requests: totals.total_requests ?? 0,
    total_input_tokens: totals.total_input_tokens ?? 0,
    total_output_tokens: totals.total_output_tokens ?? 0,
    total_cached_tokens: totals.total_cached_tokens ?? 0,
    avg_duration_ms: totals.avg_duration_ms != null ? Math.round(totals.avg_duration_ms) : null,
    avg_first_token_ms: totals.avg_first_token_ms != null ? Math.round(totals.avg_first_token_ms) : null,
    by_provider: Object.fromEntries(byProvider.map(({ provider, count }) => [provider, count])),
    by_model: Object.fromEntries(byModel.map(({ model, count }) => [model, count])),
    tool_events_total: toolEventsTotal,
    coaching_signals_total: coachingTotal
  };
}
