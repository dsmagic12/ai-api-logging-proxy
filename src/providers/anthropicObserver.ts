import type { StreamObserver, UsageRecord } from '../types.js';
import { redactString } from '../utils/redact.js';

export class AnthropicStreamObserver implements StreamObserver {
  private buffer = '';
  private text = '';
  private usage: UsageRecord | undefined;
  private responseSummary: unknown;
  private error: unknown;

  onChunk(chunk: Buffer): void {
    this.buffer += chunk.toString('utf8');
    this.consumeEvents();
  }

  finalize() {
    this.consumeEvents(true);
    return {
      text: this.text ? redactString(this.text) : undefined,
      usage: this.usage,
      responseSummary: this.responseSummary,
      error: this.error
    };
  }

  private consumeEvents(flush = false): void {
    while (true) {
      const delimiterIndex = this.buffer.indexOf('\n\n');
      if (delimiterIndex === -1) break;
      const rawEvent = this.buffer.slice(0, delimiterIndex);
      this.buffer = this.buffer.slice(delimiterIndex + 2);
      this.handleRawEvent(rawEvent);
    }

    if (flush && this.buffer.trim()) {
      this.handleRawEvent(this.buffer);
      this.buffer = '';
    }
  }

  private handleRawEvent(rawEvent: string): void {
    let eventName = '';
    const dataLines: string[] = [];

    for (const line of rawEvent.split('\n').map((item) => item.trimEnd())) {
      if (line.startsWith('event:')) eventName = line.slice(6).trim();
      if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }

    for (const data of dataLines) {
      if (!data) continue;
      try {
        const event = JSON.parse(data);
        this.handleJsonEvent(eventName, event);
      } catch {
        this.error = { parse_error: 'Could not parse Anthropic SSE data', sample: data.slice(0, 200) };
      }
    }
  }

  private handleJsonEvent(eventName: string, event: any): void {
    if (eventName === 'error' || event.type === 'error') {
      this.error = event.error ?? event;
      return;
    }

    if (event.type === 'message_start' && event.message) {
      this.responseSummary = {
        id: event.message.id,
        model: event.message.model,
        stop_reason: event.message.stop_reason
      };
      this.usage = normalizeAnthropicUsage(event.message.usage);
    }

    if (event.type === 'content_block_delta') {
      if (event.delta?.type === 'text_delta' && typeof event.delta.text === 'string') {
        this.text += event.delta.text;
      }
      if (event.delta?.type === 'thinking_delta' && typeof event.delta.thinking === 'string') {
        // Do not persist reasoning/thinking text by default; just note that it occurred.
        this.responseSummary = { ...(this.responseSummary as object), has_thinking_delta: true };
      }
    }

    if (event.type === 'message_delta') {
      this.usage = normalizeAnthropicUsage({
        ...this.usage,
        ...event.usage
      });
      this.responseSummary = {
        ...(this.responseSummary as object),
        stop_reason: event.delta?.stop_reason,
        stop_sequence: event.delta?.stop_sequence
      };
    }
  }
}

export function normalizeAnthropicUsage(usage: any): UsageRecord | undefined {
  if (!usage) return undefined;

  const outputTokens = usage.output_tokens;
  const inputTokens = usage.input_tokens;

  return {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    total_tokens:
      typeof inputTokens === 'number' || typeof outputTokens === 'number'
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined,
    cache_creation_input_tokens: usage.cache_creation_input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    server_tool_use: usage.server_tool_use
  };
}
