/* OpenCode on Novita Sandbox — front-end controller.
 *
 * - Session metadata is persisted in localStorage so sessions survive reloads.
 * - The Novita API key is kept in memory only (never written to storage).
 */

const STORAGE_KEY = 'novita-opencode-sessions';
const els = {
  main: document.getElementById('main'),
  list: document.getElementById('session-list'),
  apiKey: document.getElementById('api-key'),
  newBtn: document.getElementById('new-session-btn'),
  toast: document.getElementById('toast'),
};

let sessions = loadSessions();
let activeId = null;
let pollTimer = null;

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

function toast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.classList.toggle('error', isError);
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (els.toast.hidden = true), 4000);
}

async function api(path, options = {}) {
  const key = apiKey();
  if (!key) {
    toast('Enter your Novita API key first.', true);
    els.apiKey.focus();
    throw new Error('missing api key');
  }
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-novita-api-key': key,
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
      <div class="session-item-meta">${escapeHtml(repoLabel(s.repoUrl))} · ${timeAgo(s.createdAt)}</div>`;
    item.onclick = () => openSession(s.id);
    els.list.appendChild(item);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* ---------------- new session view ---------------- */
function renderNewSession() {
  activeId = null;
  stopPolling();
  renderSessionList();
  els.main.innerHTML = `
    <div class="panel">
      <h1>New Session</h1>
      <p class="lead">Spin up OpenCode and code-server inside a fresh Novita AI Agent Sandbox.</p>

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
          <li>Create &amp; start a Novita Sandbox session</li>
          <li>Clone the repository (if provided)</li>
          <li>Install &amp; start OpenCode and code-server on the shared filesystem</li>
          <li>Expose the ports and detect the live URLs</li>
        </ol>
      </div>
    </div>`;
  document.getElementById('run-btn').onclick = runNewSession;
}

async function runNewSession() {
  const btn = document.getElementById('run-btn');
  const name = document.getElementById('new-name').value.trim();
  const repoUrl = document.getElementById('new-repo').value.trim();
  btn.disabled = true;
  btn.textContent = 'Creating sandbox…';
  try {
    const info = await api('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ repoUrl }),
    });
    const session = {
      id: info.sandboxId,
      name: name || repoLabel(repoUrl) || 'Session',
      repoUrl,
      sandboxDomain: info.sandboxDomain,
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
  els.main.innerHTML = `
    <div class="session-header">
      <div class="session-title">
        <h1>${escapeHtml(s.name)}</h1>
        <div class="sub">${escapeHtml(repoLabel(s.repoUrl))} · Sandbox <code>${escapeHtml(s.id)}</code></div>
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
    const info = await api(`/api/sessions/${encodeURIComponent(s.id)}/status`);
    const prev = { status: s.status, opencodeReady: s.opencodeReady, codeServerReady: s.codeServerReady };
    upsertSession({
      id: s.id,
      status: info.status,
      opencodeReady: info.opencodeReady,
      codeServerReady: info.codeServerReady,
      opencodeUrl: info.opencodeUrl || s.opencodeUrl,
      codeServerUrl: info.codeServerUrl || s.codeServerUrl,
    });
    // Re-render only when something visible changed to avoid reloading iframes.
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
      body: JSON.stringify({ repoUrl: s.repoUrl }),
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
    await api(`/api/sessions/${encodeURIComponent(s.id)}/stop`, { method: 'POST' });
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
els.newBtn.onclick = renderNewSession;
renderSessionList();
renderNewSession();
