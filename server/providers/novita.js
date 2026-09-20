import { Sandbox } from 'novita-sandbox';
import {
  OPENCODE_PORT,
  CODE_SERVER_PORT,
  WORKSPACE,
  SANDBOX_TIMEOUT_MS,
  sandboxInfo,
} from './base.js';

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
  nohup code-server --bind-addr "0.0.0.0:${CODE_SERVER_PORT}" --auth none "$WORKSPACE" \
    >/tmp/code-server.log 2>&1 &
fi

# --- Start OpenCode web UI on ${OPENCODE_PORT} ---------------------------
if ! curl -fsS "http://localhost:${OPENCODE_PORT}" >/dev/null 2>&1; then
  echo "starting opencode"
  cd "$TARGET"
  nohup opencode web --hostname 0.0.0.0 --port ${OPENCODE_PORT} \
    >/tmp/opencode.log 2>&1 &
fi

echo "=== bootstrap done $(date -u) ==="
`;
}

function httpsHost(sandbox, port) {
  return `https://${sandbox.getHost(port)}`;
}

async function runBootstrap(sandbox, repoUrl) {
  await sandbox.files.write('/tmp/bootstrap.sh', bootstrapScript(repoUrl));
  await sandbox.commands.run('bash /tmp/bootstrap.sh', { background: true });
}

async function probe(url) {
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { method: 'GET', redirect: 'manual', signal: controller.signal });
    clearTimeout(t);
    return res.status > 0 && res.status < 500;
  } catch {
    return false;
  }
}

export async function createSession({ apiKey, repoUrl }) {
  const sandbox = await Sandbox.create('base', {
    apiKey,
    timeoutMs: SANDBOX_TIMEOUT_MS,
    secure: false,
    allowInternetAccess: true,
    metadata: { app: 'novita-opencode-sandbox' },
  });

  await runBootstrap(sandbox, repoUrl);

  return sandboxInfo(sandbox, { status: 'provisioning' });
}

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
