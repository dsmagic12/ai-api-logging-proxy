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
export function buildForwardHeaders(request, provider) {
    const headers = {};
    for (const [key, value] of Object.entries(request.headers)) {
        const lower = key.toLowerCase();
        if (hopByHopHeaders.has(lower))
            continue;
        if (lower === 'authorization')
            continue;
        if (Array.isArray(value))
            headers[key] = value.join(', ');
        else if (value !== undefined)
            headers[key] = String(value);
    }
    headers['content-type'] = 'application/json';
    if (provider === 'openai') {
        headers.authorization = `Bearer ${config.openaiApiKey}`;
    }
    else {
        headers['x-api-key'] = config.anthropicApiKey;
        headers['anthropic-version'] =
            headers['anthropic-version'] ??
                headers['Anthropic-Version'] ??
                config.anthropicVersion;
    }
    return headers;
}
export function copyResponseHeaders(upstreamHeaders) {
    const headers = {};
    upstreamHeaders.forEach((value, key) => {
        if (hopByHopHeaders.has(key.toLowerCase()))
            return;
        headers[key] = value;
    });
    return headers;
}
