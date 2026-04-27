export type Provider = 'openai' | 'anthropic';

export type UsageRecord = {
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  server_tool_use?: Record<string, unknown>;
};

export type AuditRecord = {
  id: string;
  timestamp: string;
  provider: Provider;
  method: string;
  path: string;
  model?: string;
  stream: boolean;
  status_code?: number;
  ok?: boolean;
  user_id?: string;
  team_id?: string;
  app_id?: string;
  provider_request_id?: string;
  duration_ms?: number;
  first_token_ms?: number;
  request_bytes?: number;
  response_bytes?: number;
  request_summary?: unknown;
  response_summary?: unknown;
  usage?: UsageRecord;
  error?: unknown;
};

export type ToolEventRecord = {
  id: string;
  timestamp: string;
  tool: 'claude-code' | 'codex' | 'unknown';
  event_type:
    | 'session_start'
    | 'session_stop'
    | 'prompt'
    | 'response'
    | 'tool_use'
    | 'file_edit'
    | 'command'
    | 'error'
    | 'heartbeat';
  user_id?: string;
  team_id?: string;
  app_id?: string;
  session_id?: string;
  conversation_id?: string;
  cwd?: string;
  repo?: string;
  model?: string;
  provider?: Provider | string;
  prompt_summary?: unknown;
  response_summary?: unknown;
  usage?: UsageRecord;
  metadata?: Record<string, unknown>;
  coaching_signals?: CoachingSignal[];
};

export type CoachingSignal = {
  code:
    | 'npm_dependency_reinstall_loop'
    | 'npm_install_retry_loop'
    | 'package_lock_churn'
    | 'excessive_command_polling';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  evidence: Record<string, unknown>;
  recommendation: string;
};

export type StreamObserver = {
  onChunk(chunk: Buffer): void;
  finalize(): {
    text?: string;
    usage?: UsageRecord;
    responseSummary?: unknown;
    error?: unknown;
  };
};
