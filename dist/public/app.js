const root = document.documentElement;
const themeButton = document.querySelector('[data-theme-toggle]');
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
root.setAttribute('data-theme', theme);

themeButton?.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', theme);
});

const els = {
  health: document.querySelector('#health-status'),
  state: document.querySelector('#stream-state'),
  response: document.querySelector('#response-output'),
  raw: document.querySelector('#raw-events'),
  input: document.querySelector('#metric-input'),
  output: document.querySelector('#metric-output'),
  firstToken: document.querySelector('#metric-first-token'),
  signal: document.querySelector('#metric-signal'),
  logList: document.querySelector('#log-list')
};

async function checkHealth() {
  try {
    const response = await fetch('/healthz');
    if (!response.ok) throw new Error('Health endpoint not available');
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) throw new Error('Static preview mode');
    const data = await response.json();
    els.health.textContent = data.ok ? 'Online' : 'Degraded';
  } catch {
    els.health.textContent = 'Preview';
  }
}

function demoChunks(provider) {
  return provider === 'anthropic'
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
}

function parseSseText(raw, provider) {
  const lines = raw.split('\n');
  let text = '';
  let usage = null;

  for (const line of lines) {
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const event = JSON.parse(payload);
      if (provider === 'anthropic') {
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          text += event.delta.text;
        }
        if (event.type === 'message_start') usage = event.message?.usage ?? usage;
        if (event.type === 'message_delta') usage = { ...usage, ...event.usage };
      } else {
        if (event.type === 'response.output_text.delta') text += event.delta;
        if (event.type === 'response.completed') usage = event.response?.usage ?? usage;
      }
    } catch {
      // Ignore incomplete demo chunks.
    }
  }
  return { text, usage };
}

async function runStream(provider) {
  els.state.textContent = `Streaming ${provider}`;
  els.response.textContent = '';
  els.raw.textContent = '';
  els.signal.textContent = provider === 'anthropic' ? 'Cache-aware prompt' : 'High context ratio';
  const started = performance.now();
  let firstChunk = null;
  let raw = '';

  try {
    const response = await fetch(`/demo/stream?provider=${provider}`);
    if (!response.ok || !response.body) throw new Error('No backend stream available');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (firstChunk === null) firstChunk = performance.now() - started;
      const chunk = decoder.decode(value, { stream: true });
      raw += chunk;
      const parsed = parseSseText(raw, provider);
      els.raw.textContent = raw;
      els.response.textContent = parsed.text || 'Waiting for text delta…';
      if (parsed.usage) {
        const inputTokens = parsed.usage.input_tokens ?? 0;
        const outputTokens = parsed.usage.output_tokens ?? 0;
        els.input.textContent = inputTokens.toLocaleString();
        els.output.textContent = outputTokens.toLocaleString();
      }
      if (firstChunk !== null) {
        els.firstToken.textContent = `${Math.round(firstChunk)} ms`;
      }
    }

    els.state.textContent = 'Complete';
  } catch (error) {
    for (const chunk of demoChunks(provider)) {
      if (firstChunk === null) firstChunk = performance.now() - started;
      raw += chunk;
      const parsed = parseSseText(raw, provider);
      els.raw.textContent = raw;
      els.response.textContent = parsed.text || 'Waiting for text delta…';
      if (parsed.usage) {
        const inputTokens = parsed.usage.input_tokens ?? 0;
        const outputTokens = parsed.usage.output_tokens ?? 0;
        els.input.textContent = inputTokens.toLocaleString();
        els.output.textContent = outputTokens.toLocaleString();
      }
      els.firstToken.textContent = `${Math.round(firstChunk)} ms`;
      await new Promise((resolve) => setTimeout(resolve, 420));
    }
    els.state.textContent = 'Complete';
  }
}

function fallbackLogs() {
  return {
    records: [
      {
        provider: 'openai',
        model: 'gpt-4o-mini',
        team_id: 'regulatory-writing',
        app_id: 'drafting-assistant',
        duration_ms: 1840,
        first_token_ms: 318,
        usage: { total_tokens: 1434 },
        coaching_signal: 'Large static context detected; candidate for prompt caching or retrieval chunking.'
      },
      {
        provider: 'anthropic',
        model: 'claude-3-5-haiku-latest',
        team_id: 'clinical-ops',
        app_id: 'protocol-summarizer',
        duration_ms: 2210,
        first_token_ms: 402,
        usage: { total_tokens: 2364 },
        coaching_signal: 'Healthy cache-read ratio; summarize prior turns before adding new references.'
      },
      {
        provider: 'tool-event',
        model: 'claude-code',
        team_id: 'platform-engineering',
        app_id: 'claude-code',
        duration_ms: 0,
        first_token_ms: 0,
        usage: { total_tokens: 0 },
        coaching_signal: 'Session event captured from wrapper or hook; join with provider logs by user and timestamp.'
      },
      {
        provider: 'tool-event',
        model: 'codex',
        team_id: 'regulatory-writing',
        app_id: 'codex',
        duration_ms: 0,
        first_token_ms: 0,
        usage: { total_tokens: 0 },
        coaching_signal: 'Codex can be routed through the OpenAI-compatible proxy provider config.'
      },
      {
        provider: 'tool-event',
        model: 'claude-code',
        team_id: 'platform-engineering',
        app_id: 'claude-code',
        duration_ms: 0,
        first_token_ms: 0,
        usage: { total_tokens: 0 },
        coaching_signal: 'Critical dependency loop: node_modules and package-lock.json deleted repeatedly, followed by npm install retries and frequent process polling.'
      }
    ]
  };
}

async function loadLogs() {
  let data;
  try {
    const response = await fetch('/demo/logs');
    if (!response.ok) throw new Error('No backend logs available');
    data = await response.json();
  } catch {
    data = fallbackLogs();
  }
  els.logList.innerHTML = '';
  for (const record of data.records) {
    const card = document.createElement('article');
    card.className = 'log-card';
    card.innerHTML = `
      <div>
        <strong>${record.provider}</strong>
        <span>${record.model}</span>
      </div>
      <div>
        <p><strong>${record.usage.total_tokens.toLocaleString()} total tokens</strong></p>
        <p>${record.team_id} · ${record.app_id} · first token ${record.first_token_ms} ms · duration ${record.duration_ms} ms</p>
        <p>${record.coaching_signal}</p>
      </div>
    `;
    els.logList.appendChild(card);
  }
}

document.querySelector('#run-openai')?.addEventListener('click', () => runStream('openai'));
document.querySelector('#run-anthropic')?.addEventListener('click', () => runStream('anthropic'));
document.querySelector('#refresh-logs')?.addEventListener('click', loadLogs);

await checkHealth();
await loadLogs();
