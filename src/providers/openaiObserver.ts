import type { StreamObserver, UsageRecord } from '../types.js';
import { redactString } from '../utils/redact.js';

export class OpenAIStreamObserver implements StreamObserver {
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
    const dataLines = rawEvent
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());

    for (const data of dataLines) {
      if (!data || data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        this.handleJsonEvent(event);
      } catch {
        this.error = { parse_error: 'Could not parse OpenAI SSE data', sample: data.slice(0, 200) };
      }
    }
  }

  private handleJsonEvent(event: any): void {
    if (event.error) this.error = event.error;

    if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
      this.text += event.delta;
    }

    if (event.type === 'response.completed' && event.response) {
      this.responseSummary = {
        id: event.response.id,
        status: event.response.status,
        model: event.response.model
      };
      this.usage = normalizeOpenAIUsage(event.response.usage);
    }

    if (event.usage) {
      this.usage = normalizeOpenAIUsage(event.usage);
    }

    // Chat Completions streaming shape.
    const choice = event.choices?.[0];
    const deltaContent = choice?.delta?.content;
    if (typeof deltaContent === 'string') this.text += deltaContent;
  }
}

export function normalizeOpenAIUsage(usage: any): UsageRecord | undefined {
  if (!usage) return undefined;

  return {
    input_tokens: usage.input_tokens ?? usage.prompt_tokens,
    output_tokens: usage.output_tokens ?? usage.completion_tokens,
    total_tokens: usage.total_tokens,
    cached_tokens: usage.input_tokens_details?.cached_tokens ?? usage.prompt_tokens_details?.cached_tokens,
    reasoning_tokens:
      usage.output_tokens_details?.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens
  };
}
