import { config } from '../config.js';

const secretPatterns: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{16,}/g, '[REDACTED_OPENAI_KEY]'],
  [/sk-ant-[A-Za-z0-9_-]{16,}/g, '[REDACTED_ANTHROPIC_KEY]'],
  [/Bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi, 'Bearer [REDACTED_TOKEN]'],
  [/\b(?!git@)[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]']
];

export function redactString(input: string): string {
  let output = input;
  for (const [pattern, replacement] of secretPatterns) {
    output = output.replace(pattern, replacement);
  }
  if (output.length > config.maxLoggedChars) {
    return `${output.slice(0, config.maxLoggedChars)}...[TRUNCATED ${output.length - config.maxLoggedChars} chars]`;
  }
  return output;
}

export function redactJson<T>(value: T): T | string {
  try {
    return JSON.parse(redactString(JSON.stringify(value))) as T;
  } catch {
    return '[UNSERIALIZABLE]';
  }
}

export function summarizeRequestBody(body: any): unknown {
  if (!body || typeof body !== 'object') return body;

  const summary: Record<string, unknown> = {
    model: body.model,
    stream: Boolean(body.stream),
    temperature: body.temperature,
    top_p: body.top_p,
    max_tokens: body.max_tokens,
    max_completion_tokens: body.max_completion_tokens,
    max_output_tokens: body.max_output_tokens,
    tool_count: Array.isArray(body.tools) ? body.tools.length : undefined
  };

  if (config.logRawContent) {
    summary.body = redactJson(body);
  } else {
    summary.content_shape = describeContentShape(body);
  }

  return summary;
}

function describeContentShape(body: any): Record<string, unknown> {
  if (Array.isArray(body.messages)) {
    return {
      api: 'messages',
      message_count: body.messages.length,
      roles: body.messages.map((m: any) => m?.role).filter(Boolean),
      approx_chars: JSON.stringify(body.messages).length
    };
  }

  if (body.input !== undefined) {
    return {
      api: 'responses',
      input_type: Array.isArray(body.input) ? 'array' : typeof body.input,
      approx_chars: JSON.stringify(body.input).length
    };
  }

  if (body.prompt !== undefined) {
    return {
      api: 'completions',
      prompt_type: Array.isArray(body.prompt) ? 'array' : typeof body.prompt,
      approx_chars: JSON.stringify(body.prompt).length
    };
  }

  return { keys: Object.keys(body) };
}
