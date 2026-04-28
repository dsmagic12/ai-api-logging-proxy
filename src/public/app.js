// ── Theme ────────────────────────────────────────────────────────────────────

const root = document.documentElement;
const themeButton = document.querySelector('[data-theme-toggle]');
let theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
root.setAttribute('data-theme', theme);

themeButton?.addEventListener('click', () => {
  theme = theme === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', theme);
});

// ── Element refs ──────────────────────────────────────────────────────────────

const els = {
  health: document.querySelector('#health-status'),
  streamState: document.querySelector('#stream-state'),
  response: document.querySelector('#response-output'),
  raw: document.querySelector('#raw-events'),
  metricRequests: document.querySelector('#metric-requests'),
  metricInput: document.querySelector('#metric-input'),
  metricFirstToken: document.querySelector('#metric-first-token'),
  metricSignals: document.querySelector('#metric-signals'),
  recordList: document.querySelector('#record-list'),
  resultsSummary: document.querySelector('#results-summary'),
  pageIndicator: document.querySelector('#page-indicator'),
  pagePrev: document.querySelector('#page-prev'),
  pageNext: document.querySelector('#page-next'),
  pageSize: document.querySelector('#page-size'),
  filtersLogs: document.querySelector('#filters-logs'),
  filtersToolEvents: document.querySelector('#filters-tool-events'),
};

// ── Dashboard state ───────────────────────────────────────────────────────────

const state = {
  tab: 'logs',
  offset: 0,
  total: 0,
  get limit() { return Number(els.pageSize?.value ?? 50); },
};

// ── Health check ──────────────────────────────────────────────────────────────

async function checkHealth() {
  try {
    const res = await fetch('/healthz');
    if (!res.ok) throw new Error();
    const ct = res.headers.get('content-type') ?? '';
    if (!ct.includes('application/json')) throw new Error();
    const data = await res.json();
    els.health.textContent = data.ok ? 'Online' : 'Degraded';
  } catch {
    els.health.textContent = 'Preview';
  }
}

// ── Stats ─────────────────────────────────────────────────────────────────────

async function loadStats() {
  try {
    const res = await fetch('/api/stats');
    if (!res.ok) return;
    const s = await res.json();
    els.metricRequests.textContent = Number(s.total_requests).toLocaleString();
    els.metricInput.textContent = formatTokens(s.total_input_tokens);
    els.metricFirstToken.textContent = s.avg_first_token_ms != null ? `${s.avg_first_token_ms} ms` : '—';
    els.metricSignals.textContent = Number(s.coaching_signals_total).toLocaleString();
  } catch {
    // stats panel stays at —
  }
}

function formatTokens(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ── Dashboard data loading ────────────────────────────────────────────────────

function buildLogParams() {
  const params = new URLSearchParams();
  const provider = document.querySelector('#filter-provider')?.value;
  const model = document.querySelector('#filter-model')?.value.trim();
  const search = document.querySelector('#filter-search')?.value.trim();
  const from = document.querySelector('#filter-from')?.value;
  const to = document.querySelector('#filter-to')?.value;
  if (provider) params.set('provider', provider);
  if (model) params.set('model', model);
  if (search) params.set('search', search);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('limit', String(state.limit));
  params.set('offset', String(state.offset));
  return params;
}

function buildToolEventParams() {
  const params = new URLSearchParams();
  const tool = document.querySelector('#filter-tool')?.value;
  const eventType = document.querySelector('#filter-event-type')?.value;
  const session = document.querySelector('#filter-session')?.value.trim();
  const from = document.querySelector('#filter-te-from')?.value;
  const to = document.querySelector('#filter-te-to')?.value;
  if (tool) params.set('tool', tool);
  if (eventType) params.set('event_type', eventType);
  if (session) params.set('session_id', session);
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('limit', String(state.limit));
  params.set('offset', String(state.offset));
  return params;
}

async function loadData() {
  els.recordList.innerHTML = '<p class="loading-text">Loading…</p>';
  try {
    const isLogs = state.tab === 'logs';
    const endpoint = isLogs ? '/api/logs' : '/api/tool-events';
    const params = isLogs ? buildLogParams() : buildToolEventParams();
    const res = await fetch(`${endpoint}?${params}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { records, total } = await res.json();

    state.total = total;
    updateResultsSummary(total);
    updatePagination(total);

    els.recordList.innerHTML = '';
    if (records.length === 0) {
      els.recordList.appendChild(renderEmpty(isLogs));
    } else {
      for (const record of records) {
        els.recordList.appendChild(isLogs ? renderLogRecord(record) : renderToolEvent(record));
      }
    }
  } catch (err) {
    els.recordList.innerHTML = `<p class="error-text">Could not load records: ${err.message}</p>`;
    els.resultsSummary.textContent = '—';
    updatePagination(0);
  }
}

// ── Render helpers ────────────────────────────────────────────────────────────

function fmtTs(ts) {
  if (!ts) return '—';
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return ts; }
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function badge(text, variant = '') {
  const span = document.createElement('span');
  span.className = `badge${variant ? ` badge-${variant}` : ''}`;
  span.textContent = text;
  return span;
}

function renderLogRecord(r) {
  const card = document.createElement('article');
  card.className = 'record-card';

  const isError = r.status_code >= 400 || r.error;
  const resSummary = r.response_summary && typeof r.response_summary === 'object' ? r.response_summary : {};
  const reqSummary = r.request_summary && typeof r.request_summary === 'object' ? r.request_summary : {};

  // Prompt: present when LOG_RAW_CONTENT=true
  const messages = Array.isArray(reqSummary.body?.messages) ? reqSummary.body.messages : null;
  const lastUserContent = messages ? [...messages].reverse().find(m => m?.role === 'user')?.content : null;
  const promptText = typeof lastUserContent === 'string' ? lastUserContent : null;

  // Shape: present when LOG_RAW_CONTENT=false
  const shape = reqSummary.content_shape ?? null;
  const shapeText = shape ? [
    shape.message_count != null && `${shape.message_count} msg`,
    Array.isArray(shape.roles) && shape.roles.join(', '),
    shape.approx_chars != null && `~${Number(shape.approx_chars).toLocaleString()} chars`,
  ].filter(Boolean).join(' · ') : null;

  // Response text: captured from stream observer regardless of LOG_RAW_CONTENT
  const responseText = typeof resSummary.text === 'string' ? resSummary.text : null;

  const contentParts = [];
  if (promptText) {
    contentParts.push(`<div class="content-block"><span class="content-label">Prompt</span><p class="content-text">${escHtml(promptText)}</p></div>`);
  } else if (shapeText) {
    contentParts.push(`<div class="content-block"><span class="content-label">Request shape</span><p class="content-text">${escHtml(shapeText)}</p></div>`);
  }
  if (responseText) {
    contentParts.push(`<div class="content-block"><span class="content-label">Response</span><p class="content-text">${escHtml(responseText)}</p></div>`);
  }
  const contentHtml = contentParts.length
    ? `<details class="record-details"><summary>Content</summary>${contentParts.join('')}</details>`
    : '';

  card.innerHTML = `
    <div class="record-header">
      <div class="record-badges"></div>
      <time class="record-time" datetime="${r.ts}">${fmtTs(r.ts)}</time>
    </div>
    <div class="record-meta">
      ${r.user_id ? `<span>${escHtml(r.user_id)}</span>` : ''}
      ${r.team_id ? `<span>${escHtml(r.team_id)}</span>` : ''}
      ${r.app_id ? `<span>${escHtml(r.app_id)}</span>` : ''}
    </div>
    <div class="record-stats">
      ${r.input_tokens != null ? `<span><strong>${Number(r.input_tokens).toLocaleString()}</strong> in</span>` : ''}
      ${r.output_tokens != null ? `<span><strong>${Number(r.output_tokens).toLocaleString()}</strong> out</span>` : ''}
      ${r.cached_tokens != null && r.cached_tokens > 0 ? `<span><strong>${Number(r.cached_tokens).toLocaleString()}</strong> cached</span>` : ''}
      ${r.duration_ms != null ? `<span>${r.duration_ms} ms</span>` : ''}
      ${r.first_token_ms != null ? `<span>TTFT ${r.first_token_ms} ms</span>` : ''}
      ${r.status_code ? `<span class="${isError ? 'stat-error' : ''}">${r.status_code}</span>` : ''}
    </div>
    ${isError && r.error ? `<div class="record-error">${escHtml(JSON.stringify(r.error).slice(0, 200))}</div>` : ''}
    ${contentHtml}
  `;

  const badgesEl = card.querySelector('.record-badges');
  if (r.provider) badgesEl.appendChild(badge(r.provider, r.provider));
  if (r.model) badgesEl.appendChild(badge(r.model));
  if (r.stream) badgesEl.appendChild(badge('stream', 'stream'));

  return card;
}

function renderToolEvent(r) {
  const card = document.createElement('article');
  card.className = 'record-card';

  const signals = Array.isArray(r.coaching_signals) ? r.coaching_signals : [];
  const hasSignals = signals.length > 0;

  card.innerHTML = `
    <div class="record-header">
      <div class="record-badges"></div>
      <time class="record-time" datetime="${r.ts}">${fmtTs(r.ts)}</time>
    </div>
    <div class="record-meta">
      ${r.session_id ? `<span title="Session">${r.session_id.slice(0, 20)}${r.session_id.length > 20 ? '…' : ''}</span>` : ''}
      ${r.user_id ? `<span>${r.user_id}</span>` : ''}
      ${r.team_id ? `<span>${r.team_id}</span>` : ''}
      ${r.repo ? `<span title="Repo">${r.repo.replace(/^.*[/:]/,'')}</span>` : r.cwd ? `<span title="cwd">${r.cwd.split('/').pop()}</span>` : ''}
    </div>
    ${hasSignals ? `
      <div class="coaching-signals">
        ${signals.map(s => `
          <div class="coaching-signal severity-${s.severity}">
            <strong>${s.code}</strong>
            <span>${s.message}</span>
          </div>
        `).join('')}
      </div>
    ` : ''}
  `;

  const badgesEl = card.querySelector('.record-badges');
  if (r.tool) badgesEl.appendChild(badge(r.tool, r.tool));
  if (r.event_type) badgesEl.appendChild(badge(r.event_type));

  return card;
}

function renderEmpty(isLogs) {
  const div = document.createElement('div');
  div.className = 'empty-state';
  div.innerHTML = isLogs
    ? `<p>No API logs yet.</p><p class="empty-hint">Point your OpenAI or Anthropic client at <code>http://localhost:8787/openai/v1</code> or <code>/anthropic/v1</code> to start capturing requests.</p>`
    : `<p>No tool events yet.</p><p class="empty-hint">Send events to <code>POST /tool-events</code> from Claude Code hooks or wrapper scripts. See <code>TOOLING.md</code> for setup.</p>`;
  return div;
}

// ── Pagination ────────────────────────────────────────────────────────────────

function updateResultsSummary(total) {
  const start = total === 0 ? 0 : state.offset + 1;
  const end = Math.min(state.offset + state.limit, total);
  els.resultsSummary.textContent = `${start}–${end} of ${total.toLocaleString()}`;
}

function updatePagination(total) {
  const page = Math.floor(state.offset / state.limit) + 1;
  const pages = Math.ceil(total / state.limit) || 1;
  els.pageIndicator.textContent = `Page ${page} of ${pages}`;
  els.pagePrev.disabled = state.offset <= 0;
  els.pageNext.disabled = state.offset + state.limit >= total;
}

// ── Filter + tab wiring ───────────────────────────────────────────────────────

function applyFilters() {
  state.offset = 0;
  loadData();
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

const debouncedApply = debounce(applyFilters, 350);

document.querySelectorAll('#filters-logs input[type=text], #filters-tool-events input[type=text]')
  .forEach(el => el.addEventListener('input', debouncedApply));

document.querySelectorAll('#filters-logs input[type=date], #filters-tool-events input[type=date]')
  .forEach(el => el.addEventListener('change', applyFilters));

document.querySelectorAll('#filters-logs select, #filters-tool-events select')
  .forEach(el => el.addEventListener('change', applyFilters));

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    state.tab = btn.dataset.tab;
    state.offset = 0;
    els.filtersLogs.classList.toggle('hidden', state.tab !== 'logs');
    els.filtersToolEvents.classList.toggle('hidden', state.tab !== 'tool-events');
    loadData();
  });
});

els.pagePrev?.addEventListener('click', () => {
  state.offset = Math.max(0, state.offset - state.limit);
  loadData();
});

els.pageNext?.addEventListener('click', () => {
  if (state.offset + state.limit < state.total) {
    state.offset += state.limit;
    loadData();
  }
});

els.pageSize?.addEventListener('change', applyFilters);

// ── Stream demo ───────────────────────────────────────────────────────────────

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
        if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') text += event.delta.text;
        if (event.type === 'message_start') usage = event.message?.usage ?? usage;
        if (event.type === 'message_delta') usage = { ...usage, ...event.usage };
      } else {
        if (event.type === 'response.output_text.delta') text += event.delta;
        if (event.type === 'response.completed') usage = event.response?.usage ?? usage;
      }
    } catch { /* ignore incomplete chunks */ }
  }
  return { text, usage };
}

async function runStream(provider) {
  els.streamState.textContent = `Streaming ${provider}`;
  els.response.textContent = '';
  els.raw.textContent = '';
  const started = performance.now();
  let firstChunk = null;
  let raw = '';

  async function processChunks(source) {
    if (source[Symbol.asyncIterator]) {
      const reader = source.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (firstChunk === null) firstChunk = performance.now() - started;
        raw += decoder.decode(value, { stream: true });
        updateStreamUI(raw, provider, firstChunk);
      }
    } else {
      for (const chunk of source) {
        if (firstChunk === null) firstChunk = performance.now() - started;
        raw += chunk;
        updateStreamUI(raw, provider, firstChunk);
        await new Promise(r => setTimeout(r, 420));
      }
    }
  }

  try {
    const res = await fetch(`/demo/stream?provider=${provider}`);
    if (!res.ok || !res.body) throw new Error('No backend stream');
    await processChunks(res.body);
  } catch {
    await processChunks(demoChunks(provider));
  }

  els.streamState.textContent = 'Complete';
  loadStats();
}

function updateStreamUI(raw, provider, firstChunk) {
  const parsed = parseSseText(raw, provider);
  els.raw.textContent = raw;
  els.response.textContent = parsed.text || 'Waiting for text delta…';
}

document.querySelector('#run-openai')?.addEventListener('click', () => runStream('openai'));
document.querySelector('#run-anthropic')?.addEventListener('click', () => runStream('anthropic'));

// ── Boot ──────────────────────────────────────────────────────────────────────

await checkHealth();
await Promise.all([loadStats(), loadData()]);
