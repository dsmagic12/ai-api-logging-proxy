import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import { config } from './config.js';
import { toolEventLogger } from './logging/toolEventLogger.js';
import { proxyAuth } from './middleware/auth.js';
import { anthropicPathFromWildcard, ensureProviderConfigured, openAIPathFromWildcard, proxyProviderRequest } from './providers/proxy.js';
import { redactJson, summarizeRequestBody } from './utils/redact.js';
import { claudeCodeSettings, codexConfig, shellWrappers } from './tooling/configSnippets.js';
import { detectDependencyLoop } from './tooling/dependencyLoopDetector.js';
const app = Fastify({
    logger: {
        transport: process.env.NODE_ENV === 'production'
            ? undefined
            : {
                target: 'pino-pretty',
                options: { colorize: true }
            }
    },
    bodyLimit: 25 * 1024 * 1024
});
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, 'public');
await app.register(helmet, {
    contentSecurityPolicy: false
});
await app.register(cors, { origin: false });
app.get('/healthz', async () => ({
    ok: true,
    service: 'ai-api-logging-proxy',
    time: new Date().toISOString()
}));
app.get('/', async (_request, reply) => {
    const html = await readFile(path.join(publicDir, 'index.html'), 'utf8');
    await reply.type('text/html; charset=utf-8').send(html);
});
app.get('/public/:asset', async (request, reply) => {
    const { asset } = request.params;
    const safeAsset = path.basename(asset);
    const filePath = path.join(publicDir, safeAsset);
    const ext = path.extname(safeAsset);
    const contentType = ext === '.css' ? 'text/css; charset=utf-8' :
        ext === '.js' ? 'text/javascript; charset=utf-8' :
            'application/octet-stream';
    const file = await readFile(filePath);
    await reply.type(contentType).send(file);
});
app.get('/demo/logs', async () => ({
    records: [
        {
            id: 'demo_req_openai_stream',
            timestamp: new Date(Date.now() - 143_000).toISOString(),
            provider: 'openai',
            model: 'gpt-4o-mini',
            stream: true,
            team_id: 'regulatory-writing',
            app_id: 'drafting-assistant',
            duration_ms: 1840,
            first_token_ms: 318,
            usage: { input_tokens: 1248, output_tokens: 186, total_tokens: 1434, cached_tokens: 512 },
            coaching_signal: 'Large static context detected; candidate for prompt caching or retrieval chunking.'
        },
        {
            id: 'demo_req_anthropic_stream',
            timestamp: new Date(Date.now() - 64_000).toISOString(),
            provider: 'anthropic',
            model: 'claude-3-5-haiku-latest',
            stream: true,
            team_id: 'clinical-ops',
            app_id: 'protocol-summarizer',
            duration_ms: 2210,
            first_token_ms: 402,
            usage: { input_tokens: 2120, output_tokens: 244, total_tokens: 2364, cache_read_input_tokens: 900 },
            coaching_signal: 'Healthy cache-read ratio; summarize prior turns before adding new references.'
        },
        {
            id: 'demo_tool_dependency_loop',
            timestamp: new Date(Date.now() - 22_000).toISOString(),
            provider: 'tool-event',
            model: 'claude-code',
            stream: false,
            team_id: 'platform-engineering',
            app_id: 'claude-code',
            duration_ms: 0,
            first_token_ms: 0,
            usage: { total_tokens: 0 },
            coaching_signal: 'Critical: repeated deletion of node_modules and package-lock.json followed by npm install. Stop reinstalling and inspect the first npm error.'
        }
    ]
}));
app.post('/tool-events', async (request, reply) => {
    const body = (request.body ?? {});
    const record = {
        id: body.id ? String(body.id) : nanoid(),
        timestamp: body.timestamp ? String(body.timestamp) : new Date().toISOString(),
        tool: body.tool === 'claude-code' || body.tool === 'codex'
            ? body.tool
            : 'unknown',
        event_type: normalizeToolEventType(body.event_type),
        user_id: String(request.headers['x-ai-user-id'] ?? body.user_id ?? ''),
        team_id: String(request.headers['x-ai-team-id'] ?? body.team_id ?? ''),
        app_id: String(request.headers['x-ai-app-id'] ?? body.app_id ?? body.tool ?? ''),
        session_id: body.session_id ? String(body.session_id) : undefined,
        conversation_id: body.conversation_id ? String(body.conversation_id) : undefined,
        cwd: body.cwd ? String(body.cwd) : undefined,
        repo: body.repo ? String(body.repo) : undefined,
        model: body.model ? String(body.model) : undefined,
        provider: body.provider ? String(body.provider) : undefined,
        prompt_summary: body.prompt_summary ?? (body.prompt === undefined ? undefined : summarizeRequestBody(body.prompt)),
        response_summary: body.response_summary ?? (body.response === undefined ? undefined : redactJson(body.response)),
        usage: body.usage,
        metadata: redactJson({
            source: body.source,
            exit_code: body.exit_code,
            command: body.command,
            files: body.files,
            duration_ms: body.duration_ms,
            raw_event: body.raw_event,
            ...(typeof body.metadata === 'object' && body.metadata !== null ? body.metadata : {})
        })
    };
    const coachingSignals = detectDependencyLoop(record);
    if (coachingSignals.length > 0) {
        record.coaching_signals = coachingSignals;
    }
    await toolEventLogger.write(record);
    await reply.send({ ok: true, id: record.id, coaching_signals: record.coaching_signals ?? [] });
});
app.post('/demo/dependency-loop', async (request, reply) => {
    const body = (request.body ?? {});
    const tool = body.tool === 'codex' ? 'codex' : 'claude-code';
    const sessionId = body.session_id || `demo-loop-${nanoid(8)}`;
    const commands = [
        'rm -rf node_modules package-lock.json',
        'npm install',
        'ps aux | grep npm',
        'rm -rf node_modules && rm -f package-lock.json',
        'npm install',
        'pgrep -fl "npm install"',
        'ps aux | grep npm',
        'jobs | grep npm',
        'sleep 1 && ps aux | grep npm',
        'pgrep -fl node'
    ];
    const results = [];
    for (const command of commands) {
        const record = {
            id: nanoid(),
            timestamp: new Date().toISOString(),
            tool,
            event_type: 'command',
            user_id: 'demo@example.com',
            team_id: 'platform-engineering',
            app_id: tool,
            session_id: sessionId,
            cwd: '/demo/repo',
            repo: 'git@github.com:company/demo.git',
            metadata: { command, source: 'demo' }
        };
        record.coaching_signals = detectDependencyLoop(record);
        await toolEventLogger.write(record);
        results.push({ command, coaching_signals: record.coaching_signals });
    }
    await reply.send({
        ok: true,
        session_id: sessionId,
        signal_count: results.reduce((sum, item) => sum + (item.coaching_signals?.length ?? 0), 0),
        results
    });
});
app.get('/tooling/config', async (request) => {
    const query = request.query;
    const proxyBaseUrl = query.proxy_base_url || `http://localhost:${config.port}`;
    return {
        codex_config_toml: codexConfig(proxyBaseUrl),
        claude_code_settings_json: claudeCodeSettings(proxyBaseUrl),
        shell_wrappers: shellWrappers(proxyBaseUrl),
        event_ingest_endpoint: `${proxyBaseUrl.replace(/\/$/, '')}/tool-events`
    };
});
app.get('/demo/stream', async (request, reply) => {
    const provider = String(request.query.provider ?? 'openai');
    const startedAt = Date.now();
    reply.raw.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-demo-provider': provider
    });
    const chunks = provider === 'anthropic'
        ? [
            'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_demo","type":"message","role":"assistant","model":"claude-3-5-haiku-latest","content":[],"usage":{"input_tokens":1480,"output_tokens":1}}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I would coach this user to trim pasted context, "}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"move repeated instructions into a reusable template, "}}\n\n',
            'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"and cap output length for summarization tasks."}}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":62}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n'
        ]
        : [
            'data: {"type":"response.created","response":{"id":"resp_demo","status":"in_progress","model":"gpt-4o-mini","usage":null}}\n\n',
            'data: {"type":"response.output_text.delta","delta":"I would flag this request as coaching-worthy because "}\n\n',
            'data: {"type":"response.output_text.delta","delta":"the input-to-output ratio is high, "}\n\n',
            'data: {"type":"response.output_text.delta","delta":"the prompt repeats policy boilerplate, "}\n\n',
            'data: {"type":"response.output_text.delta","delta":"and the task could use a smaller model after classification."}\n\n',
            'data: {"type":"response.completed","response":{"id":"resp_demo","status":"completed","model":"gpt-4o-mini","usage":{"input_tokens":1248,"output_tokens":72,"total_tokens":1320,"input_tokens_details":{"cached_tokens":512},"output_tokens_details":{"reasoning_tokens":0}}}}\n\n',
            'data: [DONE]\n\n'
        ];
    for (const chunk of chunks) {
        reply.raw.write(chunk);
        await new Promise((resolve) => setTimeout(resolve, 420));
    }
    reply.raw.write(`event: proxy_metric\ndata: ${JSON.stringify({ duration_ms: Date.now() - startedAt })}\n\n`);
    reply.raw.end();
});
app.addHook('preHandler', async (request, reply) => {
    if (request.url === '/' ||
        request.url.startsWith('/public/') ||
        request.url.startsWith('/demo/') ||
        request.url.startsWith('/tooling/config') ||
        request.url === '/healthz') {
        return;
    }
    await proxyAuth(request, reply);
});
function normalizeToolEventType(value) {
    const allowed = new Set([
        'session_start',
        'session_stop',
        'prompt',
        'response',
        'tool_use',
        'file_edit',
        'command',
        'error',
        'heartbeat'
    ]);
    return typeof value === 'string' && allowed.has(value)
        ? value
        : 'heartbeat';
}
app.all('/openai/v1/*', async (request, reply) => {
    ensureProviderConfigured('openai');
    const wildcard = request.params['*'];
    await proxyProviderRequest(request, reply, {
        provider: 'openai',
        upstreamBaseUrl: config.openaiBaseUrl,
        upstreamPath: openAIPathFromWildcard(wildcard)
    });
});
app.all('/anthropic/v1/*', async (request, reply) => {
    ensureProviderConfigured('anthropic');
    const wildcard = request.params['*'];
    await proxyProviderRequest(request, reply, {
        provider: 'anthropic',
        upstreamBaseUrl: config.anthropicBaseUrl,
        upstreamPath: anthropicPathFromWildcard(wildcard)
    });
});
app.setErrorHandler(async (error, _request, reply) => {
    app.log.error(error);
    await reply.code(500).send({
        error: 'Proxy server error',
        message: error instanceof Error ? error.message : String(error)
    });
});
await app.listen({ host: '0.0.0.0', port: config.port });
