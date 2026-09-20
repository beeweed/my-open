# OpenCode on Novita Sandbox

A minimal, production-ready web app that runs [OpenCode](https://opencode.ai) (an AI
coding agent) together with [code-server](https://github.com/coder/code-server)
(browser-based VS Code) inside a [Novita AI Agent Sandbox](https://novita.ai/sandbox).
Both tools share the **same sandbox filesystem**, so anything OpenCode edits is
immediately visible in code-server and vice-versa.

## Core flow

1. Enter your **Novita Sandbox API key** (kept in memory only — never stored in the browser).
2. Optionally provide a **repository URL** to clone into the sandbox.
3. Click **Run**. The server then:
   - Creates and starts a Novita Sandbox session (template `base`).
   - Clones the repository (if provided) into the shared workspace.
   - Installs and starts **OpenCode** (`opencode web`, port `4096`) and
     **code-server** (port `8080`) inside the sandbox.
   - Exposes the ports publicly and detects the live URLs.

## Session page

- **OpenCode Live URL** — the running OpenCode web interface.
- **Code Server URL** — browser-based VS Code on the same filesystem.
- A clear **running / provisioning / stopped / error** status badge.
- **Reconnect** (re-attach + self-heal services) and **Stop** (terminate sandbox) controls.

## Sessions

- Session metadata (id, repository, status, creation time, sandbox connection info)
  is stored in the browser's `localStorage`, so sessions remain visible after a reload.
- Reopening a session restores its page and reconnects to the running sandbox when possible.
- The **Novita API key is never stored** — re-enter it after a reload to reconnect.

## How ports are exposed

The app uses the official `novita-sandbox` SDK. Sandboxes are created with
`secure: false`, which makes each exposed port publicly reachable at:

```
https://<port>-<sandboxId>.<sandboxDomain>
```

obtained via `sandbox.getHost(port)`. No mock URLs are used — every URL points at a
real running Novita sandbox.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

Optional environment variable:

- `PORT` — port for this web app (default `3000`).

Get a Novita API key from <https://novita.ai/settings/key-management>.

## Architecture

```
server/
  index.js            Express API (create / reconnect / status / stop)
  sandbox-service.js  Novita SDK integration + sandbox bootstrap script
public/
  index.html          UI shell (sidebar + main)
  app.js              Session management, polling, rendering
  styles.css          Styling
```

The Novita SDK is server-side only; the API key is passed per-request via the
`x-novita-api-key` header and never persisted on the server or sent to the browser.

## Notes

- First provisioning takes ~1 minute while OpenCode and code-server install; the UI
  shows a "provisioning" state and polls until both services are reachable.
- Some upstream services may send `X-Frame-Options` that prevent embedding in the
  in-page preview; use the **Open ↗** button to launch them in a new tab.
