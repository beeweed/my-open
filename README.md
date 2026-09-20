# OpenCode Sandbox

A minimal, production-ready web app that runs [OpenCode](https://opencode.ai) (an AI
coding agent) together with [code-server](https://github.com/coder/code-server)
(browser-based VS Code) inside a cloud VM sandbox.

Both tools share the **same filesystem**, so anything OpenCode edits is
immediately visible in code-server and vice-versa.

## Supported providers

| Provider | Docs | SDK |
|---|---|---|
| **Novita AI** | <https://novita.ai/sandbox> | `novita-sandbox` |
| **Freestyle** | <https://www.freestyle.sh/docs> | `freestyle` |

Select the provider in the sidebar. Each provider uses its own API key header
and public URL format.

## Core flow

1. Select a **provider** and enter your **API key** (kept in memory only — never stored in the browser).
2. Optionally provide a **repository URL** to clone into the sandbox.
3. Click **Run**. The server then:
   - Creates and starts a sandbox/VM.
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

- Session metadata (id, provider, repository, status, creation time, sandbox connection info)
   is stored in the browser's `localStorage`, so sessions remain visible after a reload.
- Reopening a session restores its page and reconnects to the running sandbox when possible.
- **API keys are never stored** — re-enter them after a reload to reconnect.

## How ports are exposed

### Novita

The app uses the official `novita-sandbox` SDK. Sandboxes are created with
`secure: false`, which makes each exposed port publicly reachable at:

```
https://<port>-<sandboxId>.<sandboxDomain>
```

obtained via `sandbox.getHost(port)`.

### Freestyle

The app uses the official `freestyle` SDK. For each service, a TLS ingress rule
is created routing a free `*.style.dev` subdomain to the VM port:

```
https://<subdomain>.style.dev
```

No DNS records or certificates are needed for `style.dev` names — they are
covered by the platform's wildcard certificate.

## Run locally

```bash
npm install
npm start
# open http://localhost:3000
```

Optional environment variable:

- `PORT` — port for this web app (default `3000`).

Get a Novita API key from <https://novita.ai/settings/key-management>.

Get a Freestyle API key from <https://dash.freestyle.sh>.

## Architecture

```
server/
  index.js              Express API (create / reconnect / status / stop)
  providers/
    base.js             Shared constants (ports, workspace, timeout)
    novita.js           Novita SDK integration + bootstrap script
    freestyle.js        Freestyle SDK integration + bootstrap script
  sandbox-service.js    Provider dispatcher
public/
  index.html            UI shell (sidebar + main)
  app.js                Session management, polling, rendering
  styles.css            Styling
```

API keys are passed per-request via provider-specific headers
(`x-novita-api-key` / `x-freestyle-api-key`) and never persisted on the server
or sent to the browser.

## Notes

- First provisioning takes ~1 minute while OpenCode and code-server install; the UI
  shows a "provisioning" state and polls until both services are reachable.
- Some upstream services may send `X-Frame-Options` that prevent embedding in the
  in-page preview; use the **Open ↗** button to launch them in a new tab.
