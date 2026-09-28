const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const http = require('http');
const path = require('path');
const workspace = require('./workspace.cjs');
const git = require('./git.cjs');

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const AI_PROXY_PREFIX = '/api/openai';
const AI_PROXY_TOKEN_HEADER = 'x-outlaw-code-proxy-token';
const UPSTREAM_BASE_URL_HEADER = 'x-upstream-base-url';
const AI_PROXY_HEADER_ALLOWLIST = `authorization,content-type,accept,accept-language,user-agent,${AI_PROXY_TOKEN_HEADER},${UPSTREAM_BASE_URL_HEADER}`;

let aiProxyServer;

function readRequestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(undefined);

  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function writeJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function applyCorsHeaders(req, res) {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', AI_PROXY_HEADER_ALLOWLIST);
  res.setHeader('Access-Control-Max-Age', '86400');
  res.setHeader('Vary', 'Origin');
}

function pickRequestHeaders(req) {
  const headers = new Headers();
  const forward = ['authorization', 'content-type', 'accept', 'accept-language', 'user-agent'];

  for (const name of forward) {
    const value = req.headers[name];
    if (typeof value === 'string' && value) headers.set(name, value);
  }

  return headers;
}

function resolveUpstreamUrl(req) {
  const rawUpstream = req.headers[UPSTREAM_BASE_URL_HEADER];
  const upstreamBase = Array.isArray(rawUpstream) ? rawUpstream[0] : rawUpstream;

  if (!upstreamBase || !upstreamBase.trim()) {
    return {
      error: {
        status: 400,
        message: `Missing ${UPSTREAM_BASE_URL_HEADER} header (set from Settings base URL).`,
      },
    };
  }

  try {
    const suffix = (req.url || '').slice(AI_PROXY_PREFIX.length) || '/';
    const base = upstreamBase.trim().replace(/\/$/, '');
    const target = new URL(base + (suffix.startsWith('/') ? suffix : `/${suffix}`));

    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return {
        error: {
          status: 400,
          message: 'Upstream base URL must use http: or https:',
        },
      };
    }

    return { target };
  } catch {
    return {
      error: {
        status: 400,
        message: `Invalid X-Upstream-Base-URL: ${upstreamBase}`,
      },
    };
  }
}

async function pipeUpstream(req, res, proxyToken) {
  applyCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (!req.url?.startsWith(AI_PROXY_PREFIX)) {
    writeJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });
    return;
  }

  if (req.headers[AI_PROXY_TOKEN_HEADER] !== proxyToken) {
    writeJson(res, 403, { error: { message: 'Forbidden', type: 'forbidden' } });
    return;
  }

  const { target, error } = resolveUpstreamUrl(req);
  if (error) {
    writeJson(res, error.status, {
      error: { message: error.message, type: 'invalid_request_error' },
    });
    return;
  }

  const abort = new AbortController();
  const onClientClose = () => {
    if (!res.writableEnded) abort.abort();
  };
  res.on('close', onClientClose);

  const body = await readRequestBody(req);
  const headers = pickRequestHeaders(req);

  let upstreamRes;
  try {
    upstreamRes = await fetch(target, {
      method: req.method,
      headers,
      body: body && body.length > 0 ? new Uint8Array(body) : undefined,
      signal: abort.signal,
    });
  } catch (err) {
    res.off('close', onClientClose);
    if (abort.signal.aborted) {
      if (!res.writableEnded) res.end();
      return;
    }

    const message = err instanceof Error ? err.message : String(err);
    writeJson(res, 502, {
      error: { message: `Upstream proxy failed: ${message}`, type: 'proxy_error' },
    });
    return;
  }

  res.statusCode = upstreamRes.status;

  const hopByHop = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'content-encoding',
    'content-length',
  ]);

  upstreamRes.headers.forEach((value, key) => {
    if (hopByHop.has(key.toLowerCase())) return;
    res.setHeader(key, value);
  });

  if (!upstreamRes.body) {
    res.off('close', onClientClose);
    res.end();
    return;
  }

  const reader = upstreamRes.body.getReader();

  try {
    while (true) {
      if (abort.signal.aborted) {
        await reader.cancel();
        break;
      }

      const { done, value } = await reader.read();
      if (done) break;
      if (value && !res.write(Buffer.from(value))) {
        await new Promise((resolve) => res.once('drain', resolve));
      }
    }

    res.end();
  } catch (err) {
    try {
      await reader.cancel();
    } catch {
    }

    if (abort.signal.aborted) {
      if (!res.writableEnded) res.end();
    } else if (!res.headersSent) {
      const message = err instanceof Error ? err.message : String(err);
      writeJson(res, 502, {
        error: { message: `Upstream stream failed: ${message}`, type: 'proxy_error' },
      });
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  } finally {
    res.off('close', onClientClose);
  }
}

function startAiProxyServer() {
  const proxyToken = crypto.randomBytes(32).toString('hex');
  const server = http.createServer((req, res) => {
    pipeUpstream(req, res, proxyToken).catch((err) => {
      console.error('[electron-ai-proxy]', err);
      if (!res.headersSent) {
        applyCorsHeaders(req, res);
        writeJson(res, 500, {
          error: {
            message: err instanceof Error ? err.message : String(err),
            type: 'proxy_error',
          },
        });
      } else {
        res.destroy();
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Electron AI proxy did not bind to a local TCP port.'));
        return;
      }
      resolve({
        server,
        token: proxyToken,
        baseURL: `http://127.0.0.1:${address.port}${AI_PROXY_PREFIX}`,
      });
    });
  });
}

let mainWindow = null;

function createMainWindow(aiProxyBaseURL, aiProxyToken) {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    title: 'Outlaw Code',
    icon: iconPath,
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      additionalArguments: [
        `--outlaw-code-ai-proxy=${aiProxyBaseURL}`,
        `--outlaw-code-ai-proxy-token=${aiProxyToken}`,
      ],
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (isDevelopment) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    return;
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

/**
 * Wrap ipcMain.handle so every channel returns a serializable
 * { ok, value | error } envelope; FsError codes survive the bridge.
 */
function handleAsync(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (err) {
      return { ok: false, error: { code: err.code || 'EPERM', message: err instanceof Error ? err.message : String(err) } };
    }
  });
}

function installFsIpc() {
  handleAsync('fs:openFolder', async (preselected) => {
    let folder = typeof preselected === 'string' && preselected ? preselected : null;
    if (!folder) {
      const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
      if (result.canceled || !result.filePaths[0]) return null;
      folder = result.filePaths[0];
    }
    workspace.setRoot(folder);
    return folder;
  });
  handleAsync('fs:readDir', (p) => workspace.readDir(p));
  handleAsync('fs:readFile', (p) => workspace.readFile(p));
  handleAsync('fs:writeFile', (p, content) => workspace.writeFile(p, content));
  handleAsync('fs:createEntry', (p, kind) => workspace.createEntry(p, kind));
  handleAsync('fs:rename', (from, to) => workspace.rename(from, to));
  handleAsync('fs:delete', (p) => workspace.delete(p));
  handleAsync('fs:search', (query, maxResults) => workspace.search(query, maxResults));
  handleAsync('fs:watch', () => {
    workspace.watch((events) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('fs:watch:event', events);
      }
    });
  });
  handleAsync('fs:unwatch', () => workspace.stopWatch());
  handleAsync('git:available', () => git.isAvailable());
  handleAsync('git:status', () => (workspace.getRoot() ? git.status(workspace.getRoot()) : null));
  handleAsync('git:stage', (paths) => git.stage(workspace.getRoot(), paths));
  handleAsync('git:unstage', (paths) => git.unstage(workspace.getRoot(), paths));
  handleAsync('git:commit', (message) => git.commit(workspace.getRoot(), message));
  handleAsync('git:discard', (paths) => git.discard(workspace.getRoot(), paths));
  handleAsync('git:diff', (p) => git.diff(workspace.getRoot(), p));
}

app.whenReady().then(async () => {
  aiProxyServer = await startAiProxyServer();
  createMainWindow(aiProxyServer.baseURL, aiProxyServer.token);
  installFsIpc();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(aiProxyServer.baseURL, aiProxyServer.token);
    }
  });
});

app.on('before-quit', () => {
  aiProxyServer?.server.close();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
