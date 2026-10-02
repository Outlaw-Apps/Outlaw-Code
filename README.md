# Outlaw-code 

A Cursor-style in-browser code editor: file explorer + Monaco editor + AI chat + preview panel.

## What changed (Blink → OpenAI-compatible API)

This app previously ran on the [Blink](https://blink.new) platform — hosted auth, a hosted AI agent runtime (`useAgent` / `Agent` with sandbox tools), and live cloud sandboxes. Blink has been **fully removed**. The AI chat is now backed by the official `openai` SDK pointed at any **OpenAI-compatible endpoint** (OpenAI, OpenRouter, Together AI, local LLMs, …).

### AI configuration

Settings resolve with this priority (highest first):

1. In-app **Settings** modal (stored in `localStorage`)
2. Vite env vars (`.env.local`)
3. Built-in defaults

| Variable | Default | Purpose |
|---|---|---|
| `VITE_OPENAI_API_KEY` | _(empty)_ | API key for your provider |
| `VITE_OPENAI_BASE_URL` | `https://api.openai.com/v1` | OpenAI-compatible base URL |
| `VITE_OPENAI_MODEL` | `gpt-4o-mini` | Default model id |

Copy `.env.example` to `.env.local` and fill in your values, or set them at runtime via the **AI Settings** button (top-right of the prompt screen and the editor header).

Settings remain **one API key + base URL + model**. The browser never calls the provider origin directly: the OpenAI SDK uses a local `/api/openai` proxy endpoint, and that proxy forwards to the Settings base URL via the `X-Upstream-Base-URL` header (stripped before the upstream request). Authorization still comes from Settings. Streaming (SSE / chunked) is piped through the proxy.

> ⚠️ The API key still lives in the browser (local/personal use). The proxy solves CORS / same-origin for `npm run dev`, `npm run preview`, and the packaged Electron desktop app. The Cloudflare Workers deploy (`worker/index.ts`, see "Deploy to Cloudflare Workers") ships the same `/api/openai` forward; other static-only hosts still need their own equivalent middleware or edge Worker.

### Sandbox / preview (stub)

The sandbox, live preview, and file-explorer-against-remote-FS features relied on Blink's hosted cloud sandboxes, which no longer exist. `src/lib/sandbox.ts` now provides a minimal in-browser **stub** so the editor UI keeps working end-to-end. Wire `createSandbox` / `connectSandbox` / `getPreviewUrl` to your own sandbox or preview backend when ready.

## Development

```bash
npm install                       # .npmrc sets legacy-peer-deps (openai v5 peers on zod v3; project uses zod v4)
npm run dev                       # start Vite dev server (port 3000) — includes AI proxy
npx tsc --noEmit                  # typecheck
npx vite build                    # production build
npm run preview                   # serve build + same AI proxy middleware
```

## Deploy to Cloudflare Workers

Authenticate once, then deploy the public web build:

```bash
npx wrangler login
npm run deploy
```

`npm run deploy` runs `vite build --mode web`, checks the bundle for API keys, then runs `wrangler deploy`. To serve the same build and Worker locally at <http://localhost:8787>:

```bash
npm run preview:worker
```

`wrangler.jsonc` serves static assets from `dist/` with SPA fallback. `worker/index.ts` handles `/api/openai/*`, requires HTTPS upstreams, and limits upstream hosts through `vars.ALLOWED_UPSTREAM_HOSTS`; use `*` to allow any HTTPS host.

`.env.web` blanks `VITE_OPENAI_API_KEY` during the public web build so a provider key is never baked into the bundle. Web users enter their key in Settings.

The Worker is also connected to this GitHub repo through Workers Builds (branch `main`, custom domain `code.outlw.tech`). In the Worker's build settings use build command `npm run build:web` and deploy command `npx wrangler deploy`, and never add `VITE_OPENAI_API_KEY` as a build variable. `wrangler.jsonc` is what makes that deploy work: without it, `wrangler deploy` launches an interactive setup wizard that fails in CI.

After editing `wrangler.jsonc`, regenerate Worker bindings:

```bash
npm run types:worker
```

## Electron desktop app

Electron wraps the Vite build in a Windows desktop shell. The main Electron file opens either the local Vite dev server during development or `dist/index.html` after a production build. The packaged app starts a local `127.0.0.1` AI proxy so chat still routes through `/api/openai` without Vite running.

```bash
npm run electron:dev               # start Vite, wait for port 3000, then open Electron
npm run electron:build             # build Vite, create the installer, and keep win-unpacked
npm run electron:build:dir         # optional faster unpacked-only build for debugging
```

After `npm run electron:build`, use `release/Outlaw Code Setup <version>.exe` for installation. The installer creates the desktop and Start Menu shortcuts with the Outlaw Code icon. For debugging without installing, open `release/win-unpacked/Outlaw Code.exe`.
