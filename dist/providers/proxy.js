import { request as undiciRequest } from 'undici';
import { nanoid } from 'nanoid';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { config } from '../config.js';
import { auditLogger } from '../logging/auditLogger.js';
import { summarizeRequestBody, redactJson, redactString } from '../utils/redact.js';
import { buildForwardHeaders, copyResponseHeaders } from './headers.js';
import { OpenAIStreamObserver, normalizeOpenAIUsage } from './openaiObserver.js';
import { AnthropicStreamObserver, normalizeAnthropicUsage } from './anthropicObserver.js';
export async function proxyProviderRequest(fastifyRequest, reply, options) {
    const requestId = nanoid();
    const startedAt = Date.now();
    const body = fastifyRequest.body;
    const stream = Boolean(body?.stream);
    const headers = buildForwardHeaders(fastifyRequest, options.provider);
    const upstreamUrl = `${options.upstreamBaseUrl}${options.upstreamPath}`;
    const audit = {
        id: requestId,
        timestamp: new Date().toISOString(),
        provider: options.provider,
        method: fastifyRequest.method,
        path: options.upstreamPath,
        model: body?.model,
        stream,
        user_id: String(fastifyRequest.headers['x-ai-user-id'] ?? body?.user ?? ''),
        team_id: String(fastifyRequest.headers['x-ai-team-id'] ?? ''),
        app_id: String(fastifyRequest.headers['x-ai-app-id'] ?? ''),
        request_bytes: Buffer.byteLength(JSON.stringify(body ?? {})),
        request_summary: summarizeRequestBody(body)
    };
    try {
        const upstream = await undiciRequest(upstreamUrl, {
            method: fastifyRequest.method,
            headers,
            body: JSON.stringify(body)
        });
        audit.status_code = upstream.statusCode;
        audit.ok = upstream.statusCode >= 200 && upstream.statusCode < 300;
        audit.provider_request_id =
            upstream.headers['x-request-id']?.toString() ??
                upstream.headers['request-id']?.toString() ??
                upstream.headers['cf-ray']?.toString();
        const responseHeaders = copyResponseHeaders(new Headers(upstream.headers));
        reply.raw.writeHead(upstream.statusCode, responseHeaders);
        const contentType = String(upstream.headers['content-type'] ?? '');
        const isSse = contentType.includes('text/event-stream') || stream;
        if (isSse) {
            await streamWithObservation(upstream.body, reply, audit, options.provider === 'openai' ? new OpenAIStreamObserver() : new AnthropicStreamObserver(), startedAt);
        }
        else {
            const payload = await upstream.body.text();
            audit.response_bytes = Buffer.byteLength(payload);
            parseNonStreamingPayload(payload, options.provider, audit);
            reply.raw.end(payload);
        }
    }
    catch (error) {
        audit.ok = false;
        audit.status_code = 502;
        audit.error = redactJson({
            message: error?.message,
            name: error?.name,
            code: error?.code
        });
        reply.code(502).send({ error: 'Upstream provider request failed', request_id: requestId });
    }
    finally {
        audit.duration_ms = Date.now() - startedAt;
        await auditLogger.write(audit);
    }
}
async function streamWithObservation(upstreamBody, reply, audit, observer, startedAt) {
    let firstTokenSeen = false;
    let responseBytes = 0;
    const observingStream = async function* () {
        for await (const rawChunk of upstreamBody) {
            const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
            responseBytes += chunk.byteLength;
            if (!firstTokenSeen) {
                firstTokenSeen = true;
                audit.first_token_ms = Date.now() - startedAt;
            }
            observer.onChunk(chunk);
            yield chunk;
        }
    };
    await pipeline(Readable.from(observingStream()), reply.raw);
    const final = observer.finalize();
    audit.response_bytes = responseBytes;
    audit.usage = final.usage;
    audit.response_summary = {
        ...(typeof final.responseSummary === 'object' ? final.responseSummary : {}),
        ...(final.text ? { text: final.text } : {})
    };
    if (final.error)
        audit.error = final.error;
}
function parseNonStreamingPayload(payload, provider, audit) {
    try {
        const json = JSON.parse(payload);
        if (provider === 'openai') {
            audit.usage = normalizeOpenAIUsage(json.usage);
            audit.response_summary = config.logRawContent
                ? redactJson(json)
                : {
                    id: json.id,
                    model: json.model,
                    object: json.object,
                    status: json.status,
                    finish_reason: json.choices?.[0]?.finish_reason,
                    text: extractOpenAINonStreamingText(json)
                };
        }
        else {
            audit.usage = normalizeAnthropicUsage(json.usage);
            audit.response_summary = config.logRawContent
                ? redactJson(json)
                : {
                    id: json.id,
                    model: json.model,
                    type: json.type,
                    role: json.role,
                    stop_reason: json.stop_reason,
                    text: extractAnthropicNonStreamingText(json)
                };
        }
        if (json.error)
            audit.error = redactJson(json.error);
    }
    catch {
        audit.response_summary = { raw_text: redactString(payload) };
    }
}
function extractOpenAINonStreamingText(json) {
    const responseText = json.output_text;
    if (typeof responseText === 'string')
        return redactString(responseText);
    const chatText = json.choices?.[0]?.message?.content;
    if (typeof chatText === 'string')
        return redactString(chatText);
    return undefined;
}
function extractAnthropicNonStreamingText(json) {
    const text = json.content
        ?.filter((block) => block?.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('');
    return text ? redactString(text) : undefined;
}
export function openAIPathFromWildcard(wildcard) {
    return `/v1/${wildcard}`;
}
export function anthropicPathFromWildcard(wildcard) {
    return `/v1/${wildcard}`;
}
export function ensureProviderConfigured(provider) {
    if (provider === 'openai' && !config.openaiApiKey) {
        throw new Error('OPENAI_API_KEY is not configured');
    }
    if (provider === 'anthropic' && !config.anthropicApiKey) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
    }
}
