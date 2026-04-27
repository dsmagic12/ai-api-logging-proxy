import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length',
  'accept-encoding'
]);

export function buildForwardHeaders(
  request: FastifyRequest,
  provider: 'openai' | 'anthropic'
): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [key, value] of Object.entries(request.headers)) {
    const lower = key.toLowerCase();
    if (hopByHopHeaders.has(lower)) continue;
    if (lower === 'authorization') continue;
    if (Array.isArray(value)) headers[key] = value.join(', ');
    else if (value !== undefined) headers[key] = String(value);
  }

  headers['content-type'] = 'application/json';

  if (provider === 'openai') {
    headers.authorization = `Bearer ${config.openaiApiKey}`;
  } else {
    headers['x-api-key'] = config.anthropicApiKey;
    headers['anthropic-version'] =
      headers['anthropic-version'] ??
      headers['Anthropic-Version'] ??
      config.anthropicVersion;
  }

  return headers;
}

export function copyResponseHeaders(upstreamHeaders: Headers): Record<string, string> {
  const headers: Record<string, string> = {};
  upstreamHeaders.forEach((value, key) => {
    if (hopByHopHeaders.has(key.toLowerCase())) return;
    headers[key] = value;
  });
  return headers;
}
