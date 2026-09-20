import * as novita from './providers/novita.js';
import * as freestyle from './providers/freestyle.js';

const PROVIDERS = {
  novita,
  freestyle,
};

function getProvider(req) {
  const name = (req.body?.provider || req.query?.provider || 'novita').trim().toLowerCase();
  const mod = PROVIDERS[name];
  if (!mod) {
    throw Object.assign(new Error(`Unsupported provider: ${name}. Use "novita" or "freestyle".`), { status: 400 });
  }
  return mod;
}

function getApiKey(req, providerName) {
  const headerName = providerName === 'freestyle' ? 'x-freestyle-api-key' : 'x-novita-api-key';
  const key = req.get(headerName);
  if (!key) {
    return null;
  }
  return key;
}

function handleError(res, err) {
  console.error('[api error]', err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: err?.message || 'Unexpected error',
  });
}

export async function createSession(req) {
  const providerName = (req.body?.provider || 'novita').trim().toLowerCase();
  const mod = getProvider(req);
  const apiKey = getApiKey(req, providerName);
  if (!apiKey) {
    const headerName = providerName === 'freestyle' ? 'x-freestyle-api-key' : 'x-novita-api-key';
    throw Object.assign(new Error(`Missing ${providerName} API key. Add it in the sidebar and try again.`), { status: 401 });
  }
  const repoUrl = (req.body?.repoUrl || '').trim();
  const info = await mod.createSession({ apiKey, repoUrl });
  return { ...info, provider: providerName };
}

export async function reconnectSession(req) {
  const providerName = (req.body?.provider || 'novita').trim().toLowerCase();
  const mod = getProvider(req);
  const apiKey = getApiKey(req, providerName);
  if (!apiKey) {
    const headerName = providerName === 'freestyle' ? 'x-freestyle-api-key' : 'x-novita-api-key';
    throw Object.assign(new Error(`Missing ${providerName} API key. Add it in the sidebar and try again.`), { status: 401 });
  }
  const repoUrl = (req.body?.repoUrl || '').trim();
  const info = await mod.reconnectSession({ apiKey, sandboxId: req.params.id, repoUrl });
  return { ...info, provider: providerName };
}

export async function checkStatus(req) {
  const providerName = (req.query?.provider || 'novita').trim().toLowerCase();
  const mod = getProvider(req);
  const apiKey = getApiKey(req, providerName);
  if (!apiKey) {
    const headerName = providerName === 'freestyle' ? 'x-freestyle-api-key' : 'x-novita-api-key';
    throw Object.assign(new Error(`Missing ${providerName} API key. Add it in the sidebar and try again.`), { status: 401 });
  }
  const info = await mod.checkStatus({ apiKey, sandboxId: req.params.id });
  return { ...info, provider: providerName };
}

export async function stopSession(req) {
  const providerName = (req.body?.provider || 'novita').trim().toLowerCase();
  const mod = getProvider(req);
  const apiKey = getApiKey(req, providerName);
  if (!apiKey) {
    const headerName = providerName === 'freestyle' ? 'x-freestyle-api-key' : 'x-novita-api-key';
    throw Object.assign(new Error(`Missing ${providerName} API key. Add it in the sidebar and try again.`), { status: 401 });
  }
  const info = await mod.stopSession({ apiKey, sandboxId: req.params.id });
  return { ...info, provider: providerName };
}
