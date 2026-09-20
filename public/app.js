/* OpenCode Sandbox — front-end controller.
 *
 * - Session metadata is persisted in localStorage so sessions survive reloads.
 * - API keys are kept in memory only (never written to storage).
 */

const STORAGE_KEY = 'sandbox-sessions';
const els = {
  main: document.getElementById('main'),
  list: document.getElementById('session-list'),
  apiKey: document.getElementById('api-key'),
  provider: document.getElementById('provider'),
  newBtn: document.getElementById('new-session-btn'),
  toast: document.getElementById('toast'),
};

const PROVIDER_META = {
  novita: {
    label: 'Novita AI',
    apiKeyLabel: 'Novita API Key',
    apiKeyPlaceholder: 'sk_...',
    apiKeyHint: 'Kept in memory only — never stored in your browser.',
    sessionLabel: 'Spin up OpenCode and code-server inside a Novita AI Agent Sandbox.',
    step1: 'Create & start a Novita Sandbox session',
  },
  freestyle: {
    label: 'Freestyle',
    apiKeyLabel: 'Freestyle API Key',
    apiKeyPlaceholder: 'fs_...',
    apiKeyHint: 'Kept in memory only — never stored in your browser.',
    sessionLabel: 'Spin up OpenCode and code-server inside a Freestyle VM.',
    step1: 'Create & start a Freestyle VM',
  },
};

let sessions = loadSessions();
let activeId = null;
let pollTimer = null;
let currentProvider = (localStorage.getItem('sandbox-provider') || 'novita').toLowerCase();

function currentMeta() {
  return PROVIDER_META[currentProvider] || PROVIDER_META.novita;
}

/* ---------------- storage ---------------- */
function loadSessions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSessions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

function upsertSession(session) {
  const i = sessions.findIndex((s) => s.id === session.id);
  if (i >= 0) sessions[i] = { ...sessions[i], ...session };
  else sessions.unshift(session);
  saveSessions();
  renderSessionList();
}

function getSession(id) {
  return sessions.find((s) => s.id === id);
}

/* ---------------- helpers ---------------- */
function apiKey() {
  return els.apiKey.value.trim();
}

function selectedProvider() {
  return (els.provider?.value || currentProvider).toLowerCase();
}

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (els.toast.hidden = true), 4000);
}

function apiKeyHeader(provider) {
  return provider === 'freestyle' ? 'x-freestyle-api-key' : 'x-novita-api-key';
}

async function api(path, options = {}) {
  const provider = selectedProvider();
  const key = apiKey();
  if (!key) {
    toast(`Enter your ${currentMeta().label} API key first.`, true);
    els.apiKey.focus();
    throw new Error('missing api key');
  }
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      [apiKeyHeader(provider)]: key,
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function repoLabel(url) {
  if (!url) return 'No repository';
  try {
    return url.replace(/\.git$/, '').split('/').slice(-2).join('/');
  } catch {
    return url;
  }
}

function statusMeta(status) {
  switch (status) {
    case 'running':
      return { cls: 'status-running', label: 'Running' };
    case 'provisioning':
      return { cls: 'status-provisioning', label: 'Provisioning' };
    case 'error':
      return { cls: 'status-error', label: 'Error' };
    default:
      return { cls: 'status-stopped', label: 'Stopped' };
  }
}

function providerBadge(provider) {
  const meta = PROVIDER_META[provider] || PROVIDER_META.novita;
  return `<span class="provider-badge provider-${provider}">${meta.label}</span>`;
}

/* ---------------- sidebar ---------------- */
function renderSessionList() {
  if (!sessions.length) {
    els.list.innerHTML = '<div class="empty-hint">No sessions yet. Create one to get started.</div>';
    return;
  }
  els.list.innerHTML = '';
  for (const s of sessions) {
    const meta = statusMeta(s.status);
    const item = document.createElement('div');
    item.className = 'session-item' + (s.id === activeId ? ' active' : '');
    item.innerHTML = `
      <div class="session-item-top">
        <span class="session-item-name">${escapeHtml(s.name)}</span>
        <span class="status-badge ${meta.cls}"><span class="status-dot"></span>${meta.label}</span>
      </div>
      <div class="session-item-meta">${providerBadge(s.provider || 'novita')} ${escapeHtml(repoLabel(s.repoUrl))} · ${timeAgo(s.createdAt)}</div>`;
    item.onclick = () => openSession(s.id);
    els.list.appendChild(item);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function updateSidebarLabels() {
  const meta = currentMeta();
  const keyLabel = document.getElementById('api-key-label');
  const keyHint = document.getElementById('api-key-hint');
  const brandSub = document.querySelector('.brand-sub');
  if (keyLabel) keyLabel.textContent = meta.apiKeyLabel;
  if (els.apiKey) els.apiKey.placeholder = meta.apiKeyPlaceholder;
  if (keyHint) keyHint.textContent = meta.apiKeyHint;
  if (brandSub) brandSub.textContent = `on ${meta.label}`;
}

/* ---------------- new session view ---------------- */
function renderNewSession() {
  activeId = null;
  stopPolling();
  renderSessionList();
  const meta = currentMeta();
  els.main.innerHTML = `
    <div class="panel">
      <h1>New Session</h1>
      <p class="lead">${meta.sessionLabel}</p>

      <div class="form-group">
        <label for="provider-select">Provider</label>
        <select id="provider-select" class="input">
          <option value="novita" ${currentProvider === 'novita' ? 'selected' : ''}>Novita AI</option>
          <option value="freestyle" ${currentProvider === 'freestyle' ? 'selected' : ''}>Freestyle</option>
        </select>
      </div>

      <div class="form-group">
        <label for="new-name">Session name (optional)</label>
        <input id="new-name" class="input" placeholder="My coding session" />
      </div>

      <div class="form-group">
        <label for="new-repo">Repository URL (optional)</label>
        <input id="new-repo" class="input" placeholder="https://github.com/user/repo.git" />
      </div>

      <button id="run-btn" class="btn btn-primary">Run ▸</button>

      <div class="steps">
        Clicking <strong>Run</strong> will:
        <ol>
          <li>${meta.step1}</li>
          <li>Clone the repository (if provided)</li>
          <li>Install &amp; start OpenCode and code-server on the shared filesystem</li>
          <li>Expose the ports and detect the live URLs</li>
        </ol>
      </div>
    </div>`;

  const providerSelect = document.getElementById('provider-select');
  if (providerSelect) {
    providerSelect.value = currentProvider;
    providerSelect.onchange = () => {
      currentProvider = providerSelect.value.toLowerCase();
      localStorage.setItem('sandbox-provider', currentProvider);
      updateSidebarLabels();
      renderNewSession();
    };
  }
  document.getElementById('run-btn').onclick = runNewSession;
}

async function runNewSession() {
  const provider = selectedProvider();
  const btn = document.getElementById('run-btn');
  const name = document.getElementById('new-name').value.trim();
  const repoUrl = document.getElementById('new-repo').value.trim();
  btn.disabled = true;
  btn.textContent = 'Creating sandbox…';
  try {
    const info = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ provider, repoUrl }),
    });
    const session = {
      id: info.sandboxId,
      provider: info.provider || provider,
      name: name || repoLabel(repoUrl) || 'Session',
      repoUrl,
      opencodeUrl: info.opencodeUrl,
      codeServerUrl: info.codeServerUrl,
      status: info.status || 'provisioning',
      createdAt: Date.now(),
    };
    upsertSession(session);
    openSession(session.id);
    toast('Sandbox created — installing OpenCode & code-server…');
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = 'Run ▸';
  }
}

/* ---------------- session page ---------------- */
function openSession(id) {
  activeId = id;
  stopPolling();
  renderSessionList();
  renderSessionPage();
  pollStatus();
  pollTimer = setInterval(pollStatus, 6000);
}

function serviceCard(kind, title, desc, url, ready) {
  const overlay = ready
    ? ''
    : `<div class="frame-overlay" id="overlay-${kind}">
         <div class="spinner"></div>
         <div>Waiting for ${title} to come online…</div>
         <div style="font-size:12px">Installation can take a minute on first run.</div>
       </div>`;
  const frame = ready
    ? `<iframe src="${escapeHtml(url)}" title="${title}" referrerpolicy="no-referrer"
         sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-downloads allow-modals"></iframe>`
    : '';
  return `
    <div class="service-card">
      <div class="service-head">
        <div>
          <div class="service-name">${title}</div>
          <div class="service-desc">${desc}</div>
        </div>
      </div>
      <div class="service-url">
        <code title="${escapeHtml(url)}">${escapeHtml(url)}</code>
        <button class="icon-btn" data-copy="${escapeHtml(url)}">Copy</button>
        <a class="icon-btn" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open ↗</a>
      </div>
      <div class="service-frame">${frame}${overlay}</div>
    </div>`;
}

function renderSessionPage() {
  const s = getSession(activeId);
  if (!s) return renderNewSession();
  const meta = statusMeta(s.status);
  const provider = s.provider || 'novita';
  els.main.innerHTML = `
    <div class="session-header">
      <div class="session-title">
        <h1>${escapeHtml(s.name)}</h1>
        <div class="sub">${providerBadge(provider)} ${escapeHtml(repoLabel(s.repoUrl))} · Sandbox <code>${escapeHtml(s.id)}</code></div>
      </div>
      <div class="session-actions">
        <span class="status-badge ${meta.cls}" id="status-badge">
          <span class="status-dot"></span>${meta.label}
        </span>
        <button class="btn" id="reconnect-btn">Reconnect</button>
        <button class="btn btn-danger" id="stop-btn">Stop</button>
      </div>
    </div>

    <div class="services">
      ${serviceCard('opencode', 'OpenCode', 'AI coding agent — live interface', s.opencodeUrl, s.status === 'running' && s.opencodeReady)}
      ${serviceCard('codeserver', 'Code Server', 'Browser-based VS Code · same filesystem', s.codeServerUrl, s.status === 'running' && s.codeServerReady)}
    </div>`;

  document.getElementById('reconnect-btn').onclick = reconnectSession;
  document.getElementById('stop-btn').onclick = stopSession;
  els.main.querySelectorAll('[data-copy]').forEach((b) => {
    b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.copy).then(() => toast('URL copied'));
    };
  });
}

async function pollStatus() {
  const s = getSession(activeId);
  if (!s) return;
  try {
    const provider = s.provider || 'novita';
    const info = await api(`/api/sessions/${encodeURIComponent(s.id)}/status?provider=${encodeURIComponent(provider)}`);
    const prev = { status: s.status, opencodeReady: s.opencodeReady, codeServerReady: s.codeServerReady };
    upsertSession({
      id: s.id,
      status: info.status,
      opencodeReady: info.opencodeReady,
      codeServerReady: info.codeServerReady,
      opencodeUrl: info.opencodeUrl || s.opencodeUrl,
      codeServerUrl: info.codeServerUrl || s.codeServerUrl,
    });
    const cur = getSession(s.id);
    if (
      activeId === s.id &&
      (prev.status !== cur.status ||
        prev.opencodeReady !== cur.opencodeReady ||
        prev.codeServerReady !== cur.codeServerReady)
    ) {
      renderSessionPage();
    }
    if (info.status === 'stopped') stopPolling();
  } catch (err) {
    if (err.message !== 'missing api key') console.warn('status poll failed:', err.message);
  }
}

async function reconnectSession() {
  const s = getSession(activeId);
  if (!s) return;
  const btn = document.getElementById('reconnect-btn');
  btn.disabled = true;
  btn.textContent = 'Reconnecting…';
  try {
    const info = await api(`/api/sessions/${encodeURIComponent(s.id)}/reconnect`, {
      method: 'POST',
      body: JSON.stringify({ provider: s.provider || 'novita', repoUrl: s.repoUrl }),
    });
    upsertSession({
      id: s.id,
      status: info.status,
      opencodeUrl: info.opencodeUrl,
      codeServerUrl: info.codeServerUrl,
      opencodeReady: false,
      codeServerReady: false,
    });
    renderSessionPage();
    toast('Reconnected — ensuring services are running…');
    pollStatus();
  } catch (err) {
    toast(err.message, true);
  } finally {
    if (getSession(activeId)) {
      const b = document.getElementById('reconnect-btn');
      if (b) {
        b.disabled = false;
        b.textContent = 'Reconnect';
      }
    }
  }
}

async function stopSession() {
  const s = getSession(activeId);
  if (!s) return;
  if (!confirm(`Stop session "${s.name}"? The sandbox will be terminated.`)) return;
  const btn = document.getElementById('stop-btn');
  btn.disabled = true;
  btn.textContent = 'Stopping…';
  try {
    await api(`/api/sessions/${encodeURIComponent(s.id)}/stop`, {
      method: 'POST',
      body: JSON.stringify({ provider: s.provider || 'novita' }),
    });
    upsertSession({ id: s.id, status: 'stopped', opencodeReady: false, codeServerReady: false });
    stopPolling();
    renderSessionPage();
    toast('Sandbox stopped.');
  } catch (err) {
    toast(err.message, true);
    btn.disabled = false;
    btn.textContent = 'Stop';
  }
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/* ---------------- boot ---------------- */
if (els.provider) {
  els.provider.value = currentProvider;
  els.provider.onchange = () => {
    currentProvider = els.provider.value.toLowerCase();
    localStorage.setItem('sandbox-provider', currentProvider);
    updateSidebarLabels();
  };
}

updateSidebarLabels();
els.newBtn.onclick = renderNewSession;
renderSessionList();
renderNewSession();
