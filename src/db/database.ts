import Database from 'better-sqlite3';
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { config } from '../config.js';

let _db: Database.Database | undefined;

export function getDb(): Database.Database {
  if (!_db) {
    mkdirSync(config.logDir, { recursive: true });
    _db = new Database(path.join(config.logDir, 'ai-proxy.db'));
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    initSchema(_db);
  }
  return _db;
}

function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_request_log (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      provider TEXT NOT NULL,
      method TEXT,
      path TEXT,
      model TEXT,
      stream INTEGER DEFAULT 0,
      status_code INTEGER,
      ok INTEGER DEFAULT 0,
      user_id TEXT,
      team_id TEXT,
      app_id TEXT,
      provider_request_id TEXT,
      duration_ms INTEGER,
      first_token_ms INTEGER,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      cached_tokens INTEGER,
      reasoning_tokens INTEGER,
      request_bytes INTEGER,
      response_bytes INTEGER,
      request_summary TEXT,
      response_summary TEXT,
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_arl_ts ON ai_request_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_arl_provider ON ai_request_log(provider);
    CREATE INDEX IF NOT EXISTS idx_arl_model ON ai_request_log(model);
    CREATE INDEX IF NOT EXISTS idx_arl_user_id ON ai_request_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_arl_team_id ON ai_request_log(team_id);

    CREATE TABLE IF NOT EXISTS ai_tool_events (
      id TEXT PRIMARY KEY,
      ts TEXT NOT NULL,
      tool TEXT NOT NULL,
      event_type TEXT NOT NULL,
      user_id TEXT,
      team_id TEXT,
      app_id TEXT,
      session_id TEXT,
      conversation_id TEXT,
      cwd TEXT,
      repo TEXT,
      model TEXT,
      provider TEXT,
      prompt_summary TEXT,
      response_summary TEXT,
      usage TEXT,
      metadata TEXT,
      coaching_signals TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_ate_ts ON ai_tool_events(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_ate_tool ON ai_tool_events(tool);
    CREATE INDEX IF NOT EXISTS idx_ate_event_type ON ai_tool_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_ate_session_id ON ai_tool_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_ate_user_id ON ai_tool_events(user_id);
  `);
}
