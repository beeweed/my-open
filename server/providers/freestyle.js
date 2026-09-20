import { Freestyle } from 'freestyle';
import {
  OPENCODE_PORT,
  CODE_SERVER_PORT,
  WORKSPACE,
  SANDBOX_TIMEOUT_MS,
  sandboxInfo,
} from './base.js';

function randomSuffix() {
  return Math.random().toString(36).slice(2, 10);
}

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

async function runBootstrapBackground(vm, repoUrl) {
  await vm.fs.writeTextFile('/tmp/bootstrap.sh', bootstrapScript(repoUrl));
  const session = await vm.pty.open({
    exec: 'bash /tmp/bootstrap.sh',
    slug: 'bootstrap',
    replaceOnExit: true,
  });
  session.detach();
}

async function runBootstrapSync(vm, repoUrl) {
  await vm.fs.writeTextFile('/tmp/bootstrap.sh', bootstrapScript(repoUrl));
  await vm.exec('bash /tmp/bootstrap.sh');
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

async function resolveUrls(freestyle, vmId) {
  const { rules } = await freestyle.tls.rules.list({ vmId });
  const opencodeRule = rules.find((r) => r.destination.port === OPENCODE_PORT);
  const codeServerRule = rules.find((r) => r.destination.port === CODE_SERVER_PORT);
  return {
    opencodeUrl: opencodeRule ? `https://${opencodeRule.domain}` : null,
    codeServerUrl: codeServerRule ? `https://${codeServerRule.domain}` : null,
  };
}

export async function createSession({ apiKey, repoUrl }) {
  const freestyle = new Freestyle({ apiKey });
  const opencodeDomain = `opencode-${randomSuffix()}.style.dev`;
  const codeServerDomain = `codeserver-${randomSuffix()}.style.dev`;

  const { vm, vmId } = await freestyle.vms.create({
    snapshotId: 'freestyle/ubuntu',
    firewall: {
      rules: [
        { action: 'allow', source: {}, destination: { public: true } },
        { action: 'allow', source: { public: true }, destination: { port: OPENCODE_PORT, protocol: 'tcp' } },
        { action: 'allow', source: { public: true }, destination: { port: CODE_SERVER_PORT, protocol: 'tcp' } },
      ],
    },
    tls: {
      rules: [
        { action: 'allow', domain: opencodeDomain, source: { public: true }, destination: { port: OPENCODE_PORT } },
        { action: 'allow', domain: codeServerDomain, source: { public: true }, destination: { port: CODE_SERVER_PORT } },
      ],
    },
    metadata: { app: 'freestyle-opencode-sandbox' },
  });

  await runBootstrapBackground(vm, repoUrl);

  return sandboxInfo({
    sandboxId: vmId,
    opencodeUrl: `https://${opencodeDomain}`,
    codeServerUrl: `https://${codeServerDomain}`,
    status: 'provisioning',
  });
}

export async function reconnectSession({ apiKey, sandboxId, repoUrl }) {
  const freestyle = new Freestyle({ apiKey });
  const vm = freestyle.vms.ref(sandboxId);

  const data = await vm.data();
  if (data.state === 'stopped' || data.state === 'paused') {
    await vm.start();
  }

  await runBootstrapSync(vm, repoUrl);
  const urls = await resolveUrls(freestyle, sandboxId);

  return sandboxInfo({
    sandboxId,
    ...urls,
    status: 'provisioning',
  });
}

export async function checkStatus({ apiKey, sandboxId }) {
  const freestyle = new Freestyle({ apiKey });
  const vm = freestyle.vms.ref(sandboxId);

  let data;
  try {
    data = await vm.data();
  } catch (err) {
    if (err?.status === 404 || /not found/i.test(err?.message || '')) {
      return { status: 'stopped', running: false, opencodeReady: false, codeServerReady: false };
    }
    throw err;
  }

  if (data.state === 'stopped' || data.state === 'paused') {
    return { status: 'stopped', running: false, opencodeReady: false, codeServerReady: false };
  }

  const urls = await resolveUrls(freestyle, sandboxId);
  const [opencodeReady, codeServerReady] = await Promise.all([
    urls.opencodeUrl ? probe(urls.opencodeUrl) : Promise.resolve(false),
    urls.codeServerUrl ? probe(urls.codeServerUrl) : Promise.resolve(false),
  ]);

  return {
    sandboxId,
    ...urls,
    running: true,
    opencodeReady,
    codeServerReady,
    status: opencodeReady && codeServerReady ? 'running' : 'provisioning',
  };
}

export async function stopSession({ apiKey, sandboxId }) {
  const freestyle = new Freestyle({ apiKey });
  const vm = freestyle.vms.ref(sandboxId);
  try {
    await vm.delete();
  } catch (err) {
    if (err?.status === 404 || /not found/i.test(err?.message || '')) {
      return { status: 'stopped' };
    }
    throw err;
  }
  return { status: 'stopped' };
}
