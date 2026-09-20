import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createSession,
  reconnectSession,
  checkStatus,
  stopSession,
} from './sandbox-service.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

/**
 * The Novita API key is provided per request via a header and is never
 * persisted on the server or forwarded to the browser.
 */
function getApiKey(req, res) {
  const key = req.get('x-novita-api-key');
  if (!key) {
    res.status(401).json({ error: 'Missing Novita API key. Enter your key and try again.' });
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

// Create a new session (sandbox + provisioning).
app.post('/api/sessions', async (req, res) => {
  const apiKey = getApiKey(req, res);
  if (!apiKey) return;
  try {
    const repoUrl = (req.body?.repoUrl || '').trim();
    const info = await createSession({ apiKey, repoUrl });
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

// Reconnect to an existing sandbox and re-ensure services.
app.post('/api/sessions/:id/reconnect', async (req, res) => {
  const apiKey = getApiKey(req, res);
  if (!apiKey) return;
  try {
    const repoUrl = (req.body?.repoUrl || '').trim();
    const info = await reconnectSession({ apiKey, sandboxId: req.params.id, repoUrl });
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

// Poll status / service readiness.
app.get('/api/sessions/:id/status', async (req, res) => {
  const apiKey = getApiKey(req, res);
  if (!apiKey) return;
  try {
    const info = await checkStatus({ apiKey, sandboxId: req.params.id });
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

// Stop (kill) a sandbox.
app.post('/api/sessions/:id/stop', async (req, res) => {
  const apiKey = getApiKey(req, res);
  if (!apiKey) return;
  try {
    const info = await stopSession({ apiKey, sandboxId: req.params.id });
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`Novita OpenCode Sandbox running at http://localhost:${PORT}`);
});
