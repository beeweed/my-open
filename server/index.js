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

function handleError(res, err) {
  console.error('[api error]', err);
  const status = err?.status || err?.statusCode || 500;
  res.status(status >= 400 && status < 600 ? status : 500).json({
    error: err?.message || 'Unexpected error',
  });
}

app.post('/api/sessions', async (req, res) => {
  try {
    const info = await createSession(req);
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/sessions/:id/reconnect', async (req, res) => {
  try {
    const info = await reconnectSession(req);
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

app.get('/api/sessions/:id/status', async (req, res) => {
  try {
    const info = await checkStatus(req);
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

app.post('/api/sessions/:id/stop', async (req, res) => {
  try {
    const info = await stopSession(req);
    res.json(info);
  } catch (err) {
    handleError(res, err);
  }
});

app.listen(PORT, () => {
  console.log(`OpenCode Sandbox running at http://localhost:${PORT}`);
});
