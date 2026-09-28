# Native PowerShell Terminal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron build's fake one-command sandbox terminal with a persistent, interactive PowerShell terminal while preserving the limited browser fallback.

**Architecture:** A testable main-process terminal manager owns `node-pty` sessions and scopes each session to its Electron renderer. A narrow preload bridge carries terminal input, resize requests, streamed output, and exit events; the renderer uses `@xterm/xterm` and `@xterm/addon-fit`, while the existing sandbox terminal remains browser-only.

**Tech Stack:** Electron 39, CommonJS main/preload modules, `node-pty` 1.1.0 N-API prebuilds, `@xterm/xterm` 6.0.0, `@xterm/addon-fit` 0.11.0, React 19, TypeScript 5.9, Node's built-in test runner, electron-builder 26.

**Prerequisite:** The approved design is `docs/superpowers/specs/2026-09-28-powershell-command-palette-design.md`. Work in the `codex/powershell-command-palette` branch/worktree, not `main`.

---

## File map

- Create `electron/terminal-manager.cjs`: PowerShell candidate selection, PTY lifecycle, renderer ownership checks, and cleanup.
- Create `electron/terminal-manager.test.cjs`: fake-PTY lifecycle and ownership tests.
- Create `electron/terminal-smoke.cjs`: Electron-runtime smoke app that loads the native module and proves persistent PowerShell state.
- Modify `electron/main.cjs`: lazy terminal-manager loading, terminal IPC, event forwarding, and cleanup.
- Modify `electron/preload.cjs`: restricted terminal bridge plus early-output buffering.
- Modify `src/lib/fs/bridge.d.ts`: terminal bridge contracts.
- Modify `src/vite-env.d.ts`: add the terminal bridge to `Window.outlawCode`.
- Create `src/components/SandboxTerminal.tsx`: preserve the current limited browser terminal.
- Create `src/components/NativeTerminal.tsx`: xterm lifecycle, PTY I/O, fit/resize, restart, and terminate controls.
- Modify `src/components/TerminalPanel.tsx`: choose native Electron or browser fallback renderer.
- Modify `src/index.css`: import xterm's stylesheet and constrain its viewport.
- Modify `package.json` and `package-lock.json`: dependencies, verified N-API prebuild policy, smoke script, and packaging rules.

---

### Task 1: Install terminal dependencies and configure native packaging

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`

- [ ] **Step 1: Install exact runtime dependencies**

Run:

```powershell
npm install node-pty@1.1.0 @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 --legacy-peer-deps
```

Expected: `package.json` and `package-lock.json` change; the three packages appear under `dependencies`.

- [ ] **Step 2: Add the smoke script and preserve the verified N-API prebuild**

Update the `scripts` object in `package.json` so it includes this entry without removing the existing scripts:

```json
"test:terminal-smoke": "electron electron/terminal-smoke.cjs"
```

Add this property to the `build` object:

```json
"npmRebuild": false
```

Why: `node-pty` 1.1.0 ships a Windows x64 N-API prebuild that loads under both Node and Electron 39. Rebuilding it from source is unnecessary and fails on machines without Visual Studio's optional Spectre-mitigated libraries.

- [ ] **Step 3: Add terminal runtime files to electron-builder**

In `build.files`, add the terminal manager. Replace the existing single `"!node_modules/**/*"` entry with this ordered exclusion/re-inclusion block so it appears only once:

```json
"electron/terminal-manager.cjs",
"!node_modules/**/*",
"node_modules/node-pty/**/*",
"node_modules/node-addon-api/**/*"
```

The final relevant part of `build` must also include:

```json
"asarUnpack": [
  "node_modules/node-pty/**/*"
]
```

Keep the existing installer, icon, and Windows target configuration unchanged.

- [ ] **Step 4: Verify the shipped native prebuild under Electron**

Run the Electron executable in its Node-compatible mode:

```powershell
$env:ELECTRON_RUN_AS_NODE='1'
& '.\node_modules\electron\dist\electron.exe' -e "const p=require('node-pty'); console.log('electron node-pty OK', typeof p.spawn, process.versions.electron, process.versions.napi)"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

Expected: prints `electron node-pty OK function 39.8.10 10` (the patch version may be newer). This directly proves the shipped N-API binary loads in Electron.

- [ ] **Step 5: Verify the dependency tree and JSON syntax**

Run:

```powershell
npm ls node-pty @xterm/xterm @xterm/addon-fit electron electron-builder --depth=0
node -e "JSON.parse(require('fs').readFileSync('package.json','utf8')); console.log('package json OK')"
```

Expected: all five packages resolve and the second command prints `package json OK`.

- [ ] **Step 6: Commit**

```powershell
git add package.json package-lock.json
git commit -m "build(terminal): add pty and xterm runtime dependencies"
```

---

### Task 2: Build the tested main-process terminal manager

**Files:**
- Create: `electron/terminal-manager.test.cjs`
- Create: `electron/terminal-manager.cjs`

- [ ] **Step 1: Write the failing lifecycle and ownership tests**

Create `electron/terminal-manager.test.cjs` with this complete content:

```js
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTerminalManager } = require('./terminal-manager.cjs');

function createFakePty() {
  const processes = [];
  return {
    processes,
    spawn(file, args, options) {
      const dataListeners = new Set();
      const exitListeners = new Set();
      const process = {
        file,
        args,
        options,
        writes: [],
        resizes: [],
        killed: false,
        write(data) { this.writes.push(data); },
        resize(cols, rows) { this.resizes.push([cols, rows]); },
        kill() { this.killed = true; },
        onData(listener) {
          dataListeners.add(listener);
          return { dispose: () => dataListeners.delete(listener) };
        },
        onExit(listener) {
          exitListeners.add(listener);
          return { dispose: () => exitListeners.delete(listener) };
        },
        emitData(data) { for (const listener of dataListeners) listener(data); },
        emitExit(exitCode, signal) {
          for (const listener of exitListeners) listener({ exitCode, signal });
        },
      };
      processes.push(process);
      return process;
    },
  };
}

function setup(overrides = {}) {
  const pty = createFakePty();
  let nextId = 0;
  const manager = createTerminalManager({
    pty,
    platform: 'win32',
    env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\Program Files\\PowerShell\\7' },
    existsSync: (candidate) => candidate.endsWith('powershell.exe'),
    randomUUID: () => `session-${++nextId}`,
    ...overrides,
  });
  return { manager, pty };
}

test('creates a PowerShell session with the requested terminal size and cwd', () => {
  const { manager, pty } = setup();
  const data = [];
  const exits = [];
  const info = manager.create({
    ownerId: 7,
    cwd: 'C:\\repo',
    cols: 100,
    rows: 30,
    onData: (event) => data.push(event),
    onExit: (event) => exits.push(event),
  });

  assert.deepEqual(info, {
    id: 'session-1',
    shellName: 'Windows PowerShell',
    cwd: 'C:\\repo',
  });
  assert.equal(pty.processes.length, 1);
  assert.equal(pty.processes[0].file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.deepEqual(pty.processes[0].args, ['-NoLogo']);
  assert.equal(pty.processes[0].options.cwd, 'C:\\repo');
  assert.equal(pty.processes[0].options.cols, 100);
  assert.equal(pty.processes[0].options.rows, 30);

  pty.processes[0].emitData('PS C:\\repo> ');
  pty.processes[0].emitExit(0, undefined);
  assert.deepEqual(data, [{ sessionId: 'session-1', data: 'PS C:\\repo> ' }]);
  assert.deepEqual(exits, [{ sessionId: 'session-1', exitCode: 0, signal: undefined }]);
  assert.equal(manager.has('session-1'), false);
});

test('prefers pwsh when its path candidate exists', () => {
  const { manager, pty } = setup({ existsSync: (candidate) => candidate.endsWith('pwsh.exe') });
  const info = manager.create({ ownerId: 1, cwd: 'C:\\repo', cols: 80, rows: 24, onData() {}, onExit() {} });
  assert.equal(info.shellName, 'PowerShell 7');
  assert.match(pty.processes[0].file, /pwsh\.exe$/i);
});

test('writes and resizes only sessions owned by the calling renderer', () => {
  const { manager, pty } = setup();
  const info = manager.create({ ownerId: 7, cwd: 'C:\\repo', cols: 80, rows: 24, onData() {}, onExit() {} });

  manager.write(info.id, 7, 'Get-Location\r');
  manager.resize(info.id, 7, 120, 40);
  assert.deepEqual(pty.processes[0].writes, ['Get-Location\r']);
  assert.deepEqual(pty.processes[0].resizes, [[120, 40]]);
  assert.throws(() => manager.write(info.id, 8, 'whoami\r'), (error) => error.code === 'EPERM');
  assert.throws(() => manager.resize('missing', 7, 80, 24), (error) => error.code === 'ENOENT');
});

test('rejects invalid sizes and oversized input', () => {
  const { manager } = setup();
  const info = manager.create({ ownerId: 7, cwd: 'C:\\repo', cols: 80, rows: 24, onData() {}, onExit() {} });
  assert.throws(() => manager.resize(info.id, 7, 0, 24), (error) => error.code === 'EINVAL');
  assert.throws(() => manager.write(info.id, 7, 'x'.repeat(1024 * 1024 + 1)), (error) => error.code === 'E2BIG');
});

test('dispose and disposeOwner terminate the correct sessions', () => {
  const { manager, pty } = setup();
  const first = manager.create({ ownerId: 1, cwd: 'C:\\a', cols: 80, rows: 24, onData() {}, onExit() {} });
  manager.create({ ownerId: 1, cwd: 'C:\\a', cols: 80, rows: 24, onData() {}, onExit() {} });
  manager.create({ ownerId: 2, cwd: 'C:\\b', cols: 80, rows: 24, onData() {}, onExit() {} });

  manager.dispose(first.id, 1);
  assert.equal(pty.processes[0].killed, true);
  assert.equal(manager.has(first.id), false);

  manager.disposeOwner(1);
  assert.equal(pty.processes[1].killed, true);
  assert.equal(pty.processes[2].killed, false);
  assert.equal(manager.size(), 1);

  manager.disposeAll();
  assert.equal(pty.processes[2].killed, true);
  assert.equal(manager.size(), 0);
});
```

- [ ] **Step 2: Run the test to prove it fails**

Run:

```powershell
node --test electron/terminal-manager.test.cjs
```

Expected: FAIL with `Cannot find module './terminal-manager.cjs'`.

- [ ] **Step 3: Implement the terminal manager**

Create `electron/terminal-manager.cjs` with this complete content:

```js
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const MAX_INPUT_BYTES = 1024 * 1024;

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function findOnPath(executable, { platform, env, existsSync }) {
  const pathValue = env.PATH || env.Path || '';
  const delimiter = platform === 'win32' ? ';' : path.delimiter;
  for (const directory of pathValue.split(delimiter).filter(Boolean)) {
    const candidate = path.join(directory, executable);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function shellCandidates({ platform, env, existsSync }) {
  if (platform !== 'win32') {
    return [{ file: 'pwsh', name: 'PowerShell 7' }];
  }

  const candidates = [];
  const programFiles = env.ProgramFiles || 'C:\\Program Files';
  const defaultPwsh = path.join(programFiles, 'PowerShell', '7', 'pwsh.exe');
  const pwsh = existsSync(defaultPwsh)
    ? defaultPwsh
    : findOnPath('pwsh.exe', { platform, env, existsSync });
  if (pwsh) candidates.push({ file: pwsh, name: 'PowerShell 7' });

  const systemRoot = env.SystemRoot || 'C:\\Windows';
  const windowsPowerShell = path.join(
    systemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  if (existsSync(windowsPowerShell)) {
    candidates.push({ file: windowsPowerShell, name: 'Windows PowerShell' });
  }

  if (candidates.length === 0) {
    candidates.push(
      { file: 'pwsh.exe', name: 'PowerShell 7' },
      { file: 'powershell.exe', name: 'Windows PowerShell' },
    );
  }
  return candidates;
}

function createTerminalManager({
  pty,
  platform = process.platform,
  env = process.env,
  existsSync = fs.existsSync,
  randomUUID = crypto.randomUUID,
} = {}) {
  if (!pty || typeof pty.spawn !== 'function') {
    throw codedError('ENOTSUP', 'The native terminal module is unavailable.');
  }

  const sessions = new Map();

  function requireOwned(sessionId, ownerId) {
    const session = sessions.get(sessionId);
    if (!session) throw codedError('ENOENT', `Terminal session not found: ${sessionId}`);
    if (session.ownerId !== ownerId) throw codedError('EPERM', 'Terminal session belongs to another renderer.');
    return session;
  }

  function create({ ownerId, cwd, cols, rows, onData, onExit }) {
    if (!Number.isInteger(ownerId)) throw codedError('EINVAL', 'A renderer owner id is required.');
    if (!cwd || typeof cwd !== 'string') throw codedError('EINVAL', 'A terminal working directory is required.');
    if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
      throw codedError('EINVAL', 'Terminal columns and rows must be positive integers.');
    }

    let terminalProcess;
    let selectedShell;
    let lastError;
    for (const candidate of shellCandidates({ platform, env, existsSync })) {
      try {
        terminalProcess = pty.spawn(candidate.file, ['-NoLogo'], {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env: { ...env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
        });
        selectedShell = candidate;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!terminalProcess || !selectedShell) {
      const detail = lastError instanceof Error ? ` ${lastError.message}` : '';
      throw codedError('ENOENT', `PowerShell could not be started.${detail}`);
    }

    const id = randomUUID();
    const session = {
      id,
      ownerId,
      process: terminalProcess,
      dataDisposable: null,
      exitDisposable: null,
    };
    sessions.set(id, session);

    session.dataDisposable = terminalProcess.onData((data) => onData({ sessionId: id, data }));
    session.exitDisposable = terminalProcess.onExit(({ exitCode, signal }) => {
      sessions.delete(id);
      session.dataDisposable?.dispose();
      session.exitDisposable?.dispose();
      onExit({ sessionId: id, exitCode, signal });
    });

    return { id, shellName: selectedShell.name, cwd };
  }

  function write(sessionId, ownerId, data) {
    if (typeof data !== 'string') throw codedError('EINVAL', 'Terminal input must be a string.');
    if (Buffer.byteLength(data, 'utf8') > MAX_INPUT_BYTES) {
      throw codedError('E2BIG', 'Terminal input exceeded the 1 MiB limit.');
    }
    requireOwned(sessionId, ownerId).process.write(data);
  }

  function resize(sessionId, ownerId, cols, rows) {
    if (!Number.isInteger(cols) || cols < 1 || !Number.isInteger(rows) || rows < 1) {
      throw codedError('EINVAL', 'Terminal columns and rows must be positive integers.');
    }
    requireOwned(sessionId, ownerId).process.resize(cols, rows);
  }

  function disposeSession(session) {
    sessions.delete(session.id);
    session.dataDisposable?.dispose();
    session.exitDisposable?.dispose();
    if (!session.process.killed) session.process.kill();
  }

  function dispose(sessionId, ownerId) {
    disposeSession(requireOwned(sessionId, ownerId));
  }

  function disposeOwner(ownerId) {
    for (const session of [...sessions.values()]) {
      if (session.ownerId === ownerId) disposeSession(session);
    }
  }

  function disposeAll() {
    for (const session of [...sessions.values()]) disposeSession(session);
  }

  return {
    create,
    write,
    resize,
    dispose,
    disposeOwner,
    disposeAll,
    has: (sessionId) => sessions.has(sessionId),
    size: () => sessions.size,
  };
}

module.exports = { createTerminalManager, shellCandidates, MAX_INPUT_BYTES };
```

- [ ] **Step 4: Run the focused and full Electron tests**

Run:

```powershell
node --test electron/terminal-manager.test.cjs
npm run test:electron
```

Expected: the focused suite reports 5 passing tests; the full Electron suite passes.

- [ ] **Step 5: Check syntax and whitespace**

Run:

```powershell
node --check electron/terminal-manager.cjs
node --check electron/terminal-manager.test.cjs
git diff --check
```

Expected: all commands exit 0 with no syntax or whitespace errors.

- [ ] **Step 6: Commit**

```powershell
git add electron/terminal-manager.cjs electron/terminal-manager.test.cjs
git commit -m "feat(terminal): add owned PowerShell pty manager"
```

---

### Task 3: Wire terminal IPC and the typed preload contract

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`
- Modify: `src/lib/fs/bridge.d.ts`
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Add main-process terminal loading and IPC**

At the top of `electron/main.cjs`, after the existing workspace/git imports, add:

```js
const { createTerminalManager } = require('./terminal-manager.cjs');

let terminalManager;
let terminalLoadError;

function getTerminalManager() {
  if (terminalManager) return terminalManager;
  if (terminalLoadError) throw terminalLoadError;
  try {
    terminalManager = createTerminalManager({ pty: require('node-pty') });
    return terminalManager;
  } catch (error) {
    terminalLoadError = error instanceof Error ? error : new Error(String(error));
    terminalLoadError.code ||= 'ENOTSUP';
    throw terminalLoadError;
  }
}
```

Add this event-aware envelope helper directly after the existing `handleAsync` function:

```js
function handleAsyncWithEvent(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      return { ok: true, value: await fn(event, ...args) };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: err.code || 'EPERM',
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  });
}
```

Add this complete function after `installFsIpc`:

```js
function installTerminalIpc() {
  handleAsyncWithEvent('terminal:create', (event, cols = 80, rows = 24) => {
    const sender = event.sender;
    const ownerId = sender.id;
    const cwd = workspace.getRoot() || app.getPath('home');
    return getTerminalManager().create({
      ownerId,
      cwd,
      cols,
      rows,
      onData: (payload) => {
        if (!sender.isDestroyed()) sender.send('terminal:data', payload);
      },
      onExit: (payload) => {
        if (!sender.isDestroyed()) sender.send('terminal:exit', payload);
      },
    });
  });
  handleAsyncWithEvent('terminal:input', (event, sessionId, data) => (
    getTerminalManager().write(sessionId, event.sender.id, data)
  ));
  handleAsyncWithEvent('terminal:resize', (event, sessionId, cols, rows) => (
    getTerminalManager().resize(sessionId, event.sender.id, cols, rows)
  ));
  handleAsyncWithEvent('terminal:dispose', (event, sessionId) => (
    getTerminalManager().dispose(sessionId, event.sender.id)
  ));
}
```

In `createMainWindow`, immediately after the `BrowserWindow` construction, add renderer cleanup:

```js
  const ownerId = mainWindow.webContents.id;
  mainWindow.webContents.once('destroyed', () => {
    terminalManager?.disposeOwner(ownerId);
  });
```

In `app.whenReady`, call `installTerminalIpc()` once immediately after `installFsIpc()`.

In `app.on('before-quit')`, add this line before closing the proxy server:

```js
  terminalManager?.disposeAll();
```

- [ ] **Step 2: Replace the preload bridge with buffered terminal events**

Preserve the existing `call` function. Above `contextBridge.exposeInMainWorld`, add:

```js
const terminalDataListeners = new Map();
const terminalExitListeners = new Map();
const terminalDataBuffers = new Map();
const terminalExitBuffers = new Map();
const MAX_BUFFERED_TERMINAL_CHARS = 1024 * 1024;

ipcRenderer.on('terminal:data', (_event, payload) => {
  const listener = terminalDataListeners.get(payload.sessionId);
  if (listener) {
    listener(payload.data);
    return;
  }
  const previous = terminalDataBuffers.get(payload.sessionId) || '';
  terminalDataBuffers.set(
    payload.sessionId,
    (previous + payload.data).slice(-MAX_BUFFERED_TERMINAL_CHARS),
  );
});

ipcRenderer.on('terminal:exit', (_event, payload) => {
  const listener = terminalExitListeners.get(payload.sessionId);
  if (listener) listener(payload);
  else terminalExitBuffers.set(payload.sessionId, payload);
});
```

Add this property inside the object exposed as `window.outlawCode`, after `git`:

```js
  terminal: {
    create: (cols, rows) => call('terminal:create', cols, rows),
    input: (sessionId, data) => call('terminal:input', sessionId, data),
    resize: (sessionId, cols, rows) => call('terminal:resize', sessionId, cols, rows),
    dispose: async (sessionId) => {
      try {
        await call('terminal:dispose', sessionId);
      } finally {
        terminalDataListeners.delete(sessionId);
        terminalExitListeners.delete(sessionId);
        terminalDataBuffers.delete(sessionId);
        terminalExitBuffers.delete(sessionId);
      }
    },
    onData: (sessionId, callback) => {
      terminalDataListeners.set(sessionId, callback);
      const buffered = terminalDataBuffers.get(sessionId);
      if (buffered) {
        terminalDataBuffers.delete(sessionId);
        callback(buffered);
      }
      return () => terminalDataListeners.delete(sessionId);
    },
    onExit: (sessionId, callback) => {
      terminalExitListeners.set(sessionId, callback);
      const buffered = terminalExitBuffers.get(sessionId);
      if (buffered) {
        terminalExitBuffers.delete(sessionId);
        callback(buffered);
      }
      return () => terminalExitListeners.delete(sessionId);
    },
  },
```

- [ ] **Step 3: Add the complete TypeScript terminal contract**

Append to `src/lib/fs/bridge.d.ts`:

```ts
export interface TerminalSessionInfo {
  id: string;
  shellName: string;
  cwd: string;
}

export interface TerminalExitEvent {
  sessionId: string;
  exitCode?: number;
  signal?: number;
}

export interface OutlawCodeTerminalBridge {
  create(cols: number, rows: number): Promise<TerminalSessionInfo>;
  input(sessionId: string, data: string): Promise<void>;
  resize(sessionId: string, cols: number, rows: number): Promise<void>;
  dispose(sessionId: string): Promise<void>;
  onData(sessionId: string, callback: (data: string) => void): () => void;
  onExit(sessionId: string, callback: (event: TerminalExitEvent) => void): () => void;
}
```

Inside the `Window.outlawCode` object in `src/vite-env.d.ts`, add:

```ts
    readonly terminal?: import('./lib/fs/bridge').OutlawCodeTerminalBridge;
```

- [ ] **Step 4: Run focused verification**

Run:

```powershell
node --check electron/main.cjs
node --check electron/preload.cjs
npm run test:electron
npm run lint:types
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit**

```powershell
git add electron/main.cjs electron/preload.cjs src/lib/fs/bridge.d.ts src/vite-env.d.ts
git commit -m "feat(terminal): expose restricted Electron pty bridge"
```

---

### Task 4: Preserve the browser fallback and add the xterm renderer

**Files:**
- Create: `src/components/SandboxTerminal.tsx`
- Create: `src/components/NativeTerminal.tsx`
- Modify: `src/components/TerminalPanel.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Move the current terminal into the browser fallback**

Run:

```powershell
git mv src/components/TerminalPanel.tsx src/components/SandboxTerminal.tsx
```

In the moved file:

1. Rename `TerminalPanelProps` to `SandboxTerminalProps`.
2. Rename `export function TerminalPanel` to `export function SandboxTerminal`.
3. Replace the toolbar label `bash (sandbox)` with `Limited browser sandbox`.
4. Replace the prompt placeholder with `Limited commands: cat, find, ls...`.

Do not change its command behavior; this is the safe web fallback.

- [ ] **Step 2: Create the native xterm renderer**

Create `src/components/NativeTerminal.tsx` with this complete content:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { RefreshCw, Square, Terminal as TerminalIcon } from 'lucide-react';
import { Button } from './ui/button';
import type { TerminalSessionInfo } from '../lib/fs/bridge';

type TerminalStatus = 'starting' | 'running' | 'exited' | 'error';

export function NativeTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<string | null>(null);
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<TerminalSessionInfo | null>(null);
  const [status, setStatus] = useState<TerminalStatus>('starting');
  const [error, setError] = useState<string | null>(null);

  const restart = useCallback(() => setGeneration((value) => value + 1), []);

  const terminate = useCallback(() => {
    const bridge = window.outlawCode?.terminal;
    const sessionId = sessionRef.current;
    if (!bridge || !sessionId) return;
    void bridge.dispose(sessionId).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : 'Could not terminate PowerShell.');
      setStatus('error');
    });
  }, []);

  useEffect(() => {
    const bridge = window.outlawCode?.terminal;
    const container = containerRef.current;
    if (!bridge || !container) return undefined;

    let cancelled = false;
    let removeData: (() => void) | undefined;
    let removeExit: (() => void) | undefined;
    let createdSessionId: string | null = null;

    setSession(null);
    setStatus('starting');
    setError(null);

    const terminal = new XTerm({
      cursorBlink: true,
      convertEol: false,
      fontFamily: "'Geist Mono', 'Cascadia Code', Consolas, monospace",
      fontSize: 12,
      lineHeight: 1.15,
      scrollback: 5000,
      theme: {
        background: '#18181b',
        foreground: '#d4d4d8',
        cursor: '#22d3ee',
        selectionBackground: '#0e7490aa',
        black: '#18181b',
        brightBlack: '#71717a',
        blue: '#38bdf8',
        brightBlue: '#7dd3fc',
        cyan: '#22d3ee',
        brightCyan: '#67e8f9',
        green: '#4ade80',
        brightGreen: '#86efac',
        magenta: '#e879f9',
        brightMagenta: '#f0abfc',
        red: '#f87171',
        brightRed: '#fca5a5',
        white: '#e4e4e7',
        brightWhite: '#fafafa',
        yellow: '#facc15',
        brightYellow: '#fde047',
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    const fit = () => {
      if (cancelled || container.clientWidth === 0 || container.clientHeight === 0) return;
      fitAddon.fit();
      const sessionId = sessionRef.current;
      if (sessionId && terminal.cols > 0 && terminal.rows > 0) {
        void bridge.resize(sessionId, terminal.cols, terminal.rows).catch(() => undefined);
      }
    };

    const resizeObserver = new ResizeObserver(fit);
    resizeObserver.observe(container);
    requestAnimationFrame(fit);

    const inputDisposable = terminal.onData((data) => {
      const sessionId = sessionRef.current;
      if (!sessionId) return;
      void bridge.input(sessionId, data).catch((reason: unknown) => {
        setError(reason instanceof Error ? reason.message : 'PowerShell input failed.');
        setStatus('error');
      });
    });

    void (async () => {
      try {
        fitAddon.fit();
        const info = await bridge.create(
          Math.max(1, terminal.cols || 80),
          Math.max(1, terminal.rows || 24),
        );
        if (cancelled) {
          await bridge.dispose(info.id).catch(() => undefined);
          return;
        }
        createdSessionId = info.id;
        sessionRef.current = info.id;
        setSession(info);
        setStatus('running');
        removeData = bridge.onData(info.id, (data) => terminal.write(data));
        removeExit = bridge.onExit(info.id, (event) => {
          sessionRef.current = null;
          setStatus('exited');
          terminal.writeln(`\r\n\x1b[90m[PowerShell exited with code ${event.exitCode ?? 'unknown'}]\x1b[0m`);
        });
        fit();
        terminal.focus();
      } catch (reason) {
        if (cancelled) return;
        setStatus('error');
        setError(reason instanceof Error ? reason.message : 'PowerShell could not be started.');
        terminal.writeln('\r\n\x1b[31mPowerShell could not be started.\x1b[0m');
      }
    })();

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeData?.();
      removeExit?.();
      const sessionId = createdSessionId || sessionRef.current;
      if (sessionId) void bridge.dispose(sessionId).catch(() => undefined);
      if (sessionRef.current === sessionId) sessionRef.current = null;
      terminal.dispose();
    };
  }, [generation]);

  return (
    <div className="h-full w-full bg-[#18181b] flex flex-col text-zinc-300">
      <div className="h-7 px-3 bg-[#202024] border-b border-border/30 flex items-center justify-between text-[11px] shrink-0">
        <div className="flex items-center gap-2 text-zinc-400 min-w-0">
          <TerminalIcon size={12} className="text-[#22d3ee] shrink-0" />
          <span className="truncate">{session?.shellName ?? 'PowerShell'}</span>
          <span className="text-zinc-600">{status}</span>
          {error && <span className="text-red-400 truncate" title={error}>{error}</span>}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-zinc-400 hover:text-zinc-200"
            onClick={restart}
            title="Restart PowerShell"
          >
            <RefreshCw size={11} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 text-zinc-400 hover:text-red-400"
            onClick={terminate}
            disabled={!sessionRef.current}
            title="Terminate PowerShell"
          >
            <Square size={10} />
          </Button>
        </div>
      </div>
      <div ref={containerRef} className="outlaw-native-terminal flex-1 min-h-0 p-2" />
    </div>
  );
}
```

- [ ] **Step 3: Create the environment-selecting terminal wrapper**

Create `src/components/TerminalPanel.tsx` with this complete content:

```tsx
import { NativeTerminal } from './NativeTerminal';
import { SandboxTerminal } from './SandboxTerminal';

interface TerminalPanelProps {
  sandbox: any | null;
}

export function TerminalPanel({ sandbox }: TerminalPanelProps) {
  if (window.outlawCode?.terminal) return <NativeTerminal />;
  return <SandboxTerminal sandbox={sandbox} />;
}
```

- [ ] **Step 4: Import and constrain xterm styles**

Add this as the first line of `src/index.css`:

```css
@import '@xterm/xterm/css/xterm.css';
```

Append:

```css
.outlaw-native-terminal .xterm,
.outlaw-native-terminal .xterm-viewport,
.outlaw-native-terminal .xterm-screen {
  height: 100%;
}

.outlaw-native-terminal .xterm-viewport {
  overflow-y: auto;
}
```

- [ ] **Step 5: Run renderer checks**

Run:

```powershell
npm run lint:types
npm run lint:js
npm run build
git diff --check
```

Expected: TypeScript, ESLint, and Vite build pass. The browser bundle must not contain a bundled native `.node` module because `node-pty` is required only from Electron main.

- [ ] **Step 6: Run browser regression**

Run `npm run dev`, sign in, open the Terminal tab, and verify:

1. The toolbar says `Limited browser sandbox`.
2. `ls` still lists virtual files.
3. An unsupported command shows the existing limitation message.
4. The browser console has no `node-pty` or preload errors.

- [ ] **Step 7: Commit**

```powershell
git add src/components/SandboxTerminal.tsx src/components/NativeTerminal.tsx src/components/TerminalPanel.tsx src/index.css
git commit -m "feat(terminal): render interactive PowerShell with xterm"
```

---

### Task 5: Add an Electron-runtime terminal smoke test

**Files:**
- Create: `electron/terminal-smoke.cjs`

- [ ] **Step 1: Create the native runtime smoke app**

Create `electron/terminal-smoke.cjs` with this complete content:

```js
const { app } = require('electron');
const os = require('os');
const { createTerminalManager } = require('./terminal-manager.cjs');

const TIMEOUT_MS = 15000;

app.whenReady().then(() => {
  const manager = createTerminalManager({ pty: require('node-pty') });
  const marker = `OUTLAW_${Date.now()}`;
  let output = '';
  let settled = false;
  let shellName = 'PowerShell';

  const finish = (code, message) => {
    if (settled) return;
    settled = true;
    manager.disposeAll();
    if (message) console.log(message);
    app.exit(code);
  };

  const timer = setTimeout(() => finish(1, `terminal smoke timed out; output=${JSON.stringify(output)}`), TIMEOUT_MS);
  const info = manager.create({
    ownerId: 1,
    cwd: os.tmpdir(),
    cols: 100,
    rows: 30,
    onData: ({ data }) => {
      output += data;
      if (output.includes(marker)) {
        clearTimeout(timer);
        finish(0, `terminal smoke OK (${shellName})`);
      }
    },
    onExit: ({ exitCode }) => {
      if (!settled) {
        clearTimeout(timer);
        finish(1, `PowerShell exited early with code ${exitCode}; output=${JSON.stringify(output)}`);
      }
    },
  });
  shellName = info.shellName;

  manager.write(info.id, 1, `$env:OUTLAW_SMOKE='${marker}'; Write-Output $env:OUTLAW_SMOKE\r`);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
```

- [ ] **Step 2: Run the native Electron smoke test**

Run:

```powershell
npm run test:terminal-smoke
```

Expected: prints `terminal smoke OK` followed by `PowerShell 7` or `Windows PowerShell`, proving that the Electron-ABI native module loaded and a single persistent shell retained an environment variable.

- [ ] **Step 3: Run automated regression checks**

```powershell
npm run test:electron
npm run lint:types
npm run lint:js
npm run build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 4: Commit**

```powershell
git add electron/terminal-smoke.cjs package.json
git commit -m "test(terminal): smoke PowerShell under Electron runtime"
```

---

### Task 6: Verify development and packaged Electron terminals

**Files:**
- Verification only unless a defect is found.

- [ ] **Step 1: Run the development Electron app**

Run:

```powershell
npm run electron:dev
```

In Outlaw Code:

1. Use File > Open Folder and choose this worktree.
2. Open Terminal and confirm the prompt starts in the selected worktree.
3. Enter `$env:OUTLAW_TEST = 'works'` and then `Write-Output $env:OUTLAW_TEST`; confirm `works` appears.
4. Enter `Set-Location ..` and then `Get-Location`; confirm the changed directory persists.
5. Enter `Write-Host 'color' -ForegroundColor Cyan`; confirm cyan output.
6. Enter `Start-Sleep 30`, press `Ctrl+C`, and confirm the command stops but the prompt returns.
7. Resize the bottom panel and confirm the terminal fits the new area.
8. Use restart and terminate; confirm restart creates a new prompt and terminate reports the exit.

Do not accept a command form, one-shot process, or fake output as a pass.

- [ ] **Step 2: Build the unpacked Windows application**

Run:

```powershell
npm run electron:build:dir
```

Expected: `release/win-unpacked/Outlaw Code.exe` is created.

- [ ] **Step 3: Inspect packaged runtime contents**

Run:

```powershell
npx asar list release/win-unpacked/resources/app.asar | Select-String 'terminal-manager.cjs|NativeTerminal|TerminalPanel'
rg --files release/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty -g '*.node'
```

Expected: `terminal-manager.cjs` appears in the archive listing and at least one native `.node` file appears under `app.asar.unpacked/node_modules/node-pty`.

- [ ] **Step 4: Launch-test the unpacked application**

Launch `release/win-unpacked/Outlaw Code.exe`, open this worktree, and repeat the environment-variable persistence check from Step 1. Confirm no native-module load error appears.

- [ ] **Step 5: Run the complete terminal gate**

```powershell
npm run test:electron
npm run test:terminal-smoke
npm run lint:types
npm run lint:js
npm run build
git diff --check
git status --short
```

Expected: all automated checks pass and `git status --short` is empty.

---

## Part 1 acceptance checkpoint

Do not start the command-palette plan until all of these are true:

- Electron uses a real PowerShell PTY, not `sandbox.commands.run`.
- Shell state persists across commands.
- `Ctrl+C`, ANSI color, resize, restart, and terminate work.
- Browser mode remains a clearly labeled limited sandbox.
- The unpacked application contains and loads the rebuilt `node-pty` binary.
- Tests, typecheck, lint, Vite build, and diff checks pass.
