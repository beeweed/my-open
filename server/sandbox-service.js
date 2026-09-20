import { Sandbox } from 'novita-sandbox';

// Ports exposed inside the sandbox.
export const OPENCODE_PORT = 4096;
export const CODE_SERVER_PORT = 8080;

// Keep the sandbox alive for an hour; extended on every reconnect / status poll.
const SANDBOX_TIMEOUT_MS = 60 * 60 * 1000;

// The workspace directory shared by OpenCode and code-server.
const WORKSPACE = '/home/user/workspace';

/**
 * Build the idempotent bootstrap script that installs and starts both
 * OpenCode and code-server against the same workspace directory.
 *
 * It is safe to run multiple times: installs are skipped when the binaries
 * already exist and servers are only (re)started when their port is not
 * already listening. This makes reconnect trivially able to self-heal.
 */
function bootstrapScript(repoUrl) {
  const repo = (repoUrl || '').replace(/'/g, "'\\''");
  return `#!/usr/bin/env bash
set -u
LOG=/tmp/bootstrap.log
exec >>"$LOG" 2>&1
echo "=== bootstrap start $(date -u) ==="

export HOME="\${HOME:-/home/user}"
export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$HOME/bin:$PATH"

WORKSPACE='${WORKSPACE}'
REPO_URL='${repo}'
mkdir -p "$WORKSPACE"

# --- Clone repository (once) ---------------------------------------------
if [ -n "$REPO_URL" ] && [ ! -d "$WORKSPACE/repo/.git" ]; then
  echo "cloning $REPO_URL"
  git clone "$REPO_URL" "$WORKSPACE/repo" || echo "WARN: clone failed"
fi
TARGET="$WORKSPACE/repo"
[ -d "$TARGET" ] || TARGET="$WORKSPACE"

# --- Install code-server (once) ------------------------------------------
if ! command -v code-server >/dev/null 2>&1; then
  echo "installing code-server"
  curl -fsSL https://code-server.dev/install.sh | sh -s -- --method standalone || echo "WARN: code-server install failed"
fi

# --- Install OpenCode (once) ---------------------------------------------
if ! command -v opencode >/dev/null 2>&1 && [ ! -x "$HOME/.opencode/bin/opencode" ]; then
  echo "installing opencode"
  curl -fsSL https://opencode.ai/install | bash || echo "WARN: opencode install failed"
fi
export PATH="$HOME/.opencode/bin:$HOME/.local/bin:$PATH"

# --- Start code-server on ${CODE_SERVER_PORT} ----------------------------
if ! curl -fsS "http://localhost:${CODE_SERVER_PORT}" >/dev/null 2>&1; then
  echo "starting code-server"
  nohup code-server --bind-addr "0.0.0.0:${CODE_SERVER_PORT}" --auth none "$WORKSPACE" \\
    >/tmp/code-server.log 2>&1 &
fi

# --- Start OpenCode web UI on ${OPENCODE_PORT} ---------------------------
if ! curl -fsS "http://localhost:${OPENCODE_PORT}" >/dev/null 2>&1; then
  echo "starting opencode"
  cd "$TARGET"
  nohup opencode web --hostname 0.0.0.0 --port ${OPENCODE_PORT} \\
    >/tmp/opencode.log 2>&1 &
fi

echo "=== bootstrap done $(date -u) ==="
`;
}

function httpsHost(sandbox, port) {
  return `https://${sandbox.getHost(port)}`;
}

/**
 * Public connection info for a live sandbox, safe to send to the browser.
 */
export function sandboxInfo(sandbox, extra = {}) {
  return {
    sandboxId: sandbox.sandboxId,
    sandboxDomain: sandbox.sandboxDomain,
    opencodeUrl: httpsHost(sandbox, OPENCODE_PORT),
    codeServerUrl: httpsHost(sandbox, CODE_SERVER_PORT),
    ...extra,
  };
}

/**
 * Run (or re-run) the bootstrap script inside the sandbox in the background.
 */
async function runBootstrap(sandbox, repoUrl) {
  await sandbox.files.write('/tmp/bootstrap.sh', bootstrapScript(repoUrl));
  await sandbox.commands.run('bash /tmp/bootstrap.sh', { background: true });
}

/**
 * Create a brand new sandbox, clone the repo and kick off provisioning.
 * Returns immediately with connection info; provisioning continues in the
 * background and is observed via checkStatus().
 */
export async function createSession({ apiKey, repoUrl }) {
  const sandbox = await Sandbox.create('base', {
    apiKey,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    // Publicly reachable ports (no per-request traffic token) so the
    // OpenCode and code-server URLs open directly in the browser.
    secure: false,
    allowInternetAccess: true,
    metadata: { app: 'novita-opencode-sandbox' },
  });

  await runBootstrap(sandbox, repoUrl);

  return sandboxInfo(sandbox, { status: 'provisioning' });
}

/**
 * Reconnect to an existing sandbox by id, extend its lifetime and make sure
 * the services are running (self-healing). Throws SandboxNotFoundError if the
 * sandbox no longer exists.
 */
export async function reconnectSession({ apiKey, sandboxId, repoUrl }) {
  const sandbox = await Sandbox.connect(sandboxId, {
    apiKey,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    secure: false,
  });
  await sandbox.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});
  await runBootstrap(sandbox, repoUrl);
  return sandboxInfo(sandbox, { status: 'provisioning' });
}

/**
 * Best-effort HTTP probe of a public sandbox URL.
 */
async function probe(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
    clearTimeout(t);
    // Any HTTP response below 500 means the service is up and answering.
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Determine the current status of a session: whether the sandbox is running
 * and whether each service is reachable.
 */
export async function checkStatus({ apiKey, sandboxId }) {
  let sandbox;
  try {
    sandbox = await Sandbox.connect(sandboxId, { apiKey, secure: false });
  } catch (err) {
    if (err?.name === 'SandboxNotFoundError' || /not found/i.test(err?.message || '')) {
      return { status: 'stopped', running: false, opencodeReady: false, codeServerReady: false };
    }
    throw err;
  }

  const running = await sandbox.isRunning().catch(() => false);
  if (!running) {
    return { status: 'stopped', running: false, opencodeReady: false, codeServerReady: false };
  }

  // Keep the sandbox alive while the user is watching it.
  await sandbox.setTimeout(SANDBOX_TIMEOUT_MS).catch(() => {});

  const info = sandboxInfo(sandbox);
  const [opencodeReady, codeServerReady] = await Promise.all([
    probe(info.opencodeUrl),
    probe(info.codeServerUrl),
  ]);

  return {
    ...info,
    running: true,
    opencodeReady,
    codeServerReady,
    status: opencodeReady && codeServerReady ? 'running' : 'provisioning',
  };
}

/**
 * Stop (kill) a sandbox.
 */
export async function stopSession({ apiKey, sandboxId }) {
  try {
    await Sandbox.kill(sandboxId, { apiKey });
  } catch (err) {
    if (err?.name === 'SandboxNotFoundError' || /not found/i.test(err?.message || '')) {
      return { status: 'stopped' };
    }
    throw err;
  }
  return { status: 'stopped' };
}
