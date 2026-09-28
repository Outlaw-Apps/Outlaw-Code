# Electron Local Folders + Git (Milestone 1) Implementation Plan — Part 1 (Tasks 1–6)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan continues in `docs/superpowers/plans/2026-09-27-electron-fs-git-part2.md` (Tasks 7–12).

**Goal:** Give the Electron desktop build real local-folder editing and git support behind one `FileSystemProvider` abstraction, with the browser's virtual workspace unchanged.

**Architecture:** A provider interface (`src/lib/fs/types.ts`) with two implementations — virtual (wraps the stub sandbox's file map) and Electron (thin proxy over new `ipcMain.handle` channels backed by Node `fs` and the `git` CLI). Components consume the provider through React context and never branch on mode. All main-process FS/git ops live in `electron/workspace.cjs` and `electron/git.cjs`, plain CommonJS, unit-testable with `node --test` without a GUI.

**Tech Stack:** Electron 39 (contextIsolation on, sandbox on), React 19, Monaco via `@monaco-editor/react`, Node built-ins only (`fs/promises`, `fs.watch`, `child_process.execFile`). No new npm dependencies.

**Spec:** `docs/superpowers/specs/2026-09-27-electron-fs-git-design.md`

**Conventions used throughout:**

- Run every command from the repo root: `C:/Users/Deana/Documents/GitHub/Outlaw-Code`
- Renderer verification = `npm run lint:types` + `npm run lint:js` + manual checks (no test framework in the repo). Main-process tests use `node --test`.
- Commit after every task.

---

### Task 1: Main-process FS module — path confinement and core operations

**Files:**
- Create: `electron/workspace.cjs`
- Create: `electron/workspace.test.cjs`
- Modify: `package.json` (add `test:electron` script)

- [ ] **Step 1: Write the failing tests**

Create `electron/workspace.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fsp = require('fs/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ws = require('./workspace.cjs');

async function withRoot(t, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'outlaw-fs-'));
  ws.setRoot(dir);
  t.after(async () => {
    ws.setRoot(null);
    ws.stopWatch();
    await fsp.rm(dir, { recursive: true, force: true });
  });
  await fn(dir);
}

test('writeFile then readFile roundtrip', async (t) => {
  await withRoot(t, async (dir) => {
    await ws.writeFile('a.txt', 'hello');
    assert.strictEqual(await ws.readFile('a.txt'), 'hello');
    assert.strictEqual(await fsp.readFile(path.join(dir, 'a.txt'), 'utf8'), 'hello');
  });
});

test('writeFile creates parent directories', async (t) => {
  await withRoot(t, async (dir) => {
    await ws.writeFile(path.join('src', 'nested', 'b.ts'), 'x');
    assert.strictEqual(fs.existsSync(path.join(dir, 'src', 'nested', 'b.ts')), true);
  });
});

test('readFile rejects on missing file with ENOENT code', async (t) => {
  await withRoot(t, async () => {
    await assert.rejects(() => ws.readFile('nope.txt'), (err) => err.code === 'ENOENT');
  });
});

test('readDir lists dirs first, sorted, with kind', async (t) => {
  await withRoot(t, async () => {
    await ws.writeFile('z.txt', '1');
    await ws.writeFile('a.txt', '2');
    await ws.createEntry('lib', 'dir');
    const { entries } = await ws.readDir('.');
    assert.deepStrictEqual(entries.map((e) => [e.name, e.kind]), [['lib', 'dir'], ['a.txt', 'file'], ['z.txt', 'file']]);
  });
});

test('readDir caps at MAX_ENTRIES and reports capped', async (t) => {
  await withRoot(t, async () => {
    for (let i = 0; i < 5; i++) await ws.writeFile(`f${i}.txt`, String(i));
    const realMax = ws.MAX_ENTRIES;
    ws.MAX_ENTRIES = 3; // simulate a huge directory
    const { entries, capped } = await ws.readDir('.');
    ws.MAX_ENTRIES = realMax;
    assert.strictEqual(entries.length, 3);
    assert.strictEqual(capped, true);
  });
});

test('paths outside root are rejected with OUTSIDE_ROOT', async (t) => {
  await withRoot(t, async (dir) => {
    await assert.rejects(() => ws.readFile(path.join(dir, '..', 'escape.txt')), (err) => err.code === 'OUTSIDE_ROOT');
    await assert.rejects(() => ws.writeFile('..\\..\\x.txt', 'x'), (err) => err.code === 'OUTSIDE_ROOT');
    await assert.rejects(() => ws.readFile('C:/Windows/win.ini'), (err) => err.code === 'OUTSIDE_ROOT');
  });
});

test('symlink escaping root is rejected with OUTSIDE_ROOT', async (t) => {
  await withRoot(t, async (dir) => {
    const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'outlaw-outside-'));
    t.after(() => fsp.rm(outside, { recursive: true, force: true }));
    await fsp.writeFile(path.join(outside, 'secret.txt'), 'secret');
    await fsp.symlink(outside, path.join(dir, 'link'));
    await assert.rejects(() => ws.readFile(path.join('link', 'secret.txt')), (err) => err.code === 'OUTSIDE_ROOT');
  });
});

test('createEntry creates files and dirs', async (t) => {
  await withRoot(t, async (dir) => {
    await ws.createEntry('newdir', 'dir');
    await ws.createEntry(path.join('newdir', 'f.js'), 'file');
    assert.strictEqual(fs.statSync(path.join(dir, 'newdir')).isDirectory(), true);
    assert.strictEqual(fs.existsSync(path.join(dir, 'newdir', 'f.js')), true);
  });
});

test('rename moves files and confines destination', async (t) => {
  await withRoot(t, async () => {
    await ws.writeFile('old.txt', 'data');
    await ws.rename('old.txt', 'sub/new.txt');
    assert.strictEqual(await ws.readFile('sub/new.txt'), 'data');
    await assert.rejects(() => ws.rename('sub/new.txt', '../escape.txt'), (err) => err.code === 'OUTSIDE_ROOT');
  });
});

test('delete removes files and directories recursively', async (t) => {
  await withRoot(t, async () => {
    await ws.writeFile(path.join('d', 'x.txt'), '1');
    await ws.delete('d');
    await assert.rejects(() => ws.readFile(path.join('d', 'x.txt')), (err) => err.code === 'ENOENT');
  });
});

test('operations fail with EPERM when no root is set', async () => {
  ws.setRoot(null);
  await assert.rejects(() => ws.readFile('a.txt'), (err) => err.code === 'EPERM');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test electron/workspace.test.cjs`
Expected: FAIL — `Cannot find module './workspace.cjs'`

- [ ] **Step 3: Add the test script, then implement `electron/workspace.cjs`**

Add to `package.json` scripts:

```json
"test:electron": "node --test electron/"
```

Create `electron/workspace.cjs`:

```js
/**
 * Main-process workspace filesystem for the Electron build.
 * All paths from the renderer are confined to the opened root.
 * Plain CommonJS so it is unit-testable with `node --test` without Electron.
 */
const fsp = require('fs/promises');
const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_ENTRIES = 2000;
const SKIPPED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'build', '.next']);
const BINARY_EXT = /\.(exe|dll|so|dylib|zip|tar|gz|rar|7z|mp4|mov|avi|mkv|mp3|wav|ogg|png|jpe?g|gif|webp|ico|bmp|pdf|woff2?|ttf|otf|eot)$/i;
const MAX_READ_BYTES = 5 * 1024 * 1024;
const MAX_SEARCH_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_RESULTS = 200;

class FsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = 'FsError';
  }
}

let root = null;
let watcher = null;
let watchCallback = null;
let pendingEventPaths = new Set();
let watchFlushTimer = null;
let watchRestartTimer = null;

module.exports.MAX_ENTRIES = DEFAULT_MAX_ENTRIES;
module.exports.FsError = FsError;

module.exports.setRoot = function setRoot(dir) {
  module.exports.stopWatch();
  root = dir;
};

module.exports.getRoot = function getRoot() {
  return root;
};

function isInsideRoot(candidate) {
  if (!root) return false;
  const rel = path.relative(root, candidate);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Resolve a renderer-supplied path against the root and verify it stays inside
 * it — including through symlinks (realpath on the deepest existing
 * ancestor, so create/rename targets that do not exist yet still validate
 * their existing ancestor chain).
 */
module.exports.resolveInside = async function resolveInside(target) {
  if (!root) throw new FsError('EPERM', 'No folder is open');
  const abs = path.resolve(root, target);
  if (!isInsideRoot(abs)) throw new FsError('OUTSIDE_ROOT', `Path escapes workspace root: ${target}`);
  let existing = abs;
  while (existing !== root && !fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    existing = parent;
  }
  const real = await fsp.realpath(existing).catch(() => existing);
  if (!isInsideRoot(real)) throw new FsError('OUTSIDE_ROOT', `Path escapes workspace root: ${target}`);
  return abs;
};

function mapFsError(err) {
  if (err instanceof FsError) return err;
  if (err.code === 'ENOENT') return new FsError('ENOENT', err.message);
  if (err.code === 'EISDIR') return new FsError('EISDIR', err.message);
  if (err.code === 'EACCES' || err.code === 'EPERM') return new FsError('EACCES', err.message);
  return err;
}

module.exports.readDir = async function readDir(dirPath) {
  const abs = await module.exports.resolveInside(dirPath);
  let names;
  try {
    names = await fsp.readdir(abs);
  } catch (err) {
    throw mapFsError(err);
  }
  const capped = names.length > module.exports.MAX_ENTRIES;
  const entries = [];
  for (const name of names.slice(0, module.exports.MAX_ENTRIES)) {
    const full = path.join(abs, name);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;
    entries.push({ name, path: full, kind: stat.isDirectory() ? 'dir' : 'file' });
  }
  entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
  return { entries, capped };
};

module.exports.readFile = async function readFile(filePath) {
  const abs = await module.exports.resolveInside(filePath);
  let stat;
  try {
    stat = await fsp.stat(abs);
  } catch (err) {
    throw mapFsError(err);
  }
  if (stat.isDirectory()) throw new FsError('EISDIR', `Is a directory: ${filePath}`);
  if (stat.size > MAX_READ_BYTES) throw new FsError('EPERM', `File too large to open (>5MB): ${filePath}`);
  try {
    return await fsp.readFile(abs, 'utf8');
  } catch (err) {
    throw mapFsError(err);
  }
};

module.exports.writeFile = async function writeFile(filePath, content) {
  const abs = await module.exports.resolveInside(filePath);
  try {
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf8');
  } catch (err) {
    throw mapFsError(err);
  }
};

module.exports.createEntry = async function createEntry(entryPath, kind) {
  const abs = await module.exports.resolveInside(entryPath);
  try {
    if (kind === 'dir') {
      await fsp.mkdir(abs, { recursive: true });
    } else {
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      await fsp.writeFile(abs, '', 'utf8');
    }
  } catch (err) {
    throw mapFsError(err);
  }
};

module.exports.rename = async function rename(oldPath, newPath) {
  const absFrom = await module.exports.resolveInside(oldPath);
  const absTo = await module.exports.resolveInside(newPath);
  try {
    await fsp.mkdir(path.dirname(absTo), { recursive: true });
    await fsp.rename(absFrom, absTo);
  } catch (err) {
    throw mapFsError(err);
  }
};

module.exports.delete = async function remove(targetPath) {
  const abs = await module.exports.resolveInside(targetPath);
  try {
    await fsp.rm(abs, { recursive: true, force: true });
  } catch (err) {
    throw mapFsError(err);
  }
};

/** Search is implemented in Task 2. */
module.exports.search = async function search() {
  return [];
};

/** Watch is implemented in Task 3. */
module.exports.watch = function watch() {};
module.exports.stopWatch = function stopWatch() {
  if (watchFlushTimer) clearTimeout(watchFlushTimer);
  if (watchRestartTimer) clearTimeout(watchRestartTimer);
  watchFlushTimer = null;
  watchRestartTimer = null;
  if (watcher) {
    watcher.close();
    watcher = null;
  }
  pendingEventPaths = new Set();
  watchCallback = null;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron`
Expected: all tests PASS (11 tests, 0 failures)

- [ ] **Step 5: Commit**

```bash
git add electron/workspace.cjs electron/workspace.test.cjs package.json
git commit -m "feat(electron): workspace fs module with root confinement, core ops, node tests"
```

---

### Task 2: Main-process FS module — workspace search

**Files:**
- Modify: `electron/workspace.cjs` (replace the `search` stub)
- Modify: `electron/workspace.test.cjs` (append tests)

- [ ] **Step 1: Append failing tests to `electron/workspace.test.cjs`**

```js
test('search finds matches with line/column info', async (t) => {
  await withRoot(t, async () => {
    await ws.writeFile('a.ts', 'const x = 1;\nconst target = 2;\n');
    await ws.writeFile(path.join('sub', 'b.ts'), 'function target() {}\n');
    const results = await ws.search('target');
    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].path.endsWith('a.ts'), true);
    assert.strictEqual(results[0].line, 2);
    assert.strictEqual(results[0].matchStart, 6);
    assert.strictEqual(results[0].matchEnd, 12);
  });
});

test('search skips node_modules and binary extensions', async (t) => {
  await withRoot(t, async () => {
    await ws.writeFile(path.join('node_modules', 'dep.js'), 'target here');
    await ws.writeFile('img.png', 'target in a binary');
    const results = await ws.search('target');
    assert.strictEqual(results.length, 0);
  });
});

test('search respects maxResults', async (t) => {
  await withRoot(t, async () => {
    for (let i = 0; i < 10; i++) await ws.writeFile(`f${i}.txt`, 'target\n');
    const results = await ws.search('target', 5);
    assert.strictEqual(results.length, 5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:electron`
Expected: the three new tests FAIL, earlier tests still pass.

- [ ] **Step 3: Implement search in `electron/workspace.cjs`**

Replace the `search` stub with:

```js
module.exports.search = async function search(query, maxResults = DEFAULT_MAX_RESULTS) {
  if (!root) throw new FsError('EPERM', 'No folder is open');
  if (!query) return [];
  const needle = query.toLowerCase();
  const results = [];
  const stack = [root];

  while (stack.length > 0 && results.length < maxResults) {
    const dir = stack.pop();
    let names;
    try {
      names = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (results.length >= maxResults) break;
      if (SKIPPED_DIR_NAMES.has(name)) continue;
      const full = path.join(dir, name);
      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (stat.size > MAX_SEARCH_BYTES || BINARY_EXT.test(name)) continue;
      let content;
      try {
        content = await fsp.readFile(full, 'utf8');
      } catch {
        continue;
      }
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const lower = lines[i].toLowerCase();
        const idx = lower.indexOf(needle);
        if (idx !== -1) {
          results.push({ path: full, line: i + 1, lineText: lines[i].slice(0, 300), matchStart: idx, matchEnd: idx + query.length });
        }
      }
    }
  }
  return results;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add electron/workspace.cjs electron/workspace.test.cjs
git commit -m "feat(electron): workspace-wide text search with skip lists and result caps"
```

---

### Task 3: Main-process FS module — file watching

**Files:**
- Modify: `electron/workspace.cjs` (replace the `watch` stub)
- Modify: `electron/workspace.test.cjs` (append tests)

- [ ] **Step 1: Append failing tests**

```js
test('watch emits changed and deleted events', async (t) => {
  await withRoot(t, async (dir) => {
    const events = [];
    await new Promise((resolve) => {
      ws.watch((batch) => { for (const e of batch) events.push(e); });
      setTimeout(resolve, 300); // let the watcher establish
      ws.writeFile('w1.txt', 'one');
      setTimeout(() => ws.writeFile('w1.txt', 'two'), 100);
      setTimeout(() => ws.delete('w1.txt'), 200);
    });
    await new Promise((resolve) => setTimeout(resolve, 800)); // flush window
    assert.strictEqual(events.some((e) => e.path.endsWith('w1.txt') && e.type === 'changed'), true);
    assert.strictEqual(events.some((e) => e.path.endsWith('w1.txt') && e.type === 'deleted'), true);
  });
});

test('watch batches bursts into one callback', async (t) => {
  await withRoot(t, async () => {
    let calls = 0;
    ws.watch(() => { calls += 1; });
    for (let i = 0; i < 10; i++) await ws.writeFile(`burst${i}.txt`, 'x');
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.strictEqual(calls <= 2, true, `expected <= 2 callbacks, got ${calls}`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:electron`
Expected: the two new tests FAIL (no events emitted).

- [ ] **Step 3: Implement the watcher**

Replace the `watch` stub in `electron/workspace.cjs` with:

```js
function flushWatchEvents() {
  if (watchFlushTimer) return;
  watchFlushTimer = setTimeout(async () => {
    watchFlushTimer = null;
    const paths = [...pendingEventPaths];
    pendingEventPaths = new Set();
    const events = [];
    for (const p of paths) {
      const exists = await fsp.lstat(p).then(() => true).catch(() => false);
      events.push({ type: exists ? 'changed' : 'deleted', path: p });
    }
    if (watchCallback && events.length > 0) watchCallback(events);
  }, 300);
}

module.exports.watch = function watch(onEvents) {
  module.exports.stopWatch();
  if (!root) return;
  watchCallback = onEvents;
  try {
    watcher = fs.watch(root, { recursive: true }, (_type, filename) => {
      if (typeof filename !== 'string' || !filename) return;
      pendingEventPaths.add(path.join(root, filename));
      flushWatchEvents();
    });
  } catch {
    return;
  }
  watcher.on('error', () => {
    watcher = null;
    if (watchRestartTimer) return;
    watchRestartTimer = setTimeout(() => {
      watchRestartTimer = null;
      if (watchCallback) module.exports.watch(watchCallback);
    }, 2000);
  });
};
```

Note on the event-type union: `fs.watch` cannot distinguish created from modified without extra snapshot state, and nothing in M1 needs that distinction. The renderer `FsEvent` type is therefore `'changed' | 'deleted'` — a documented deviation from the spec's `'changed' | 'created' | 'deleted'`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron`
Expected: all tests PASS. Windows `fs.watch` is recursive natively, so nested paths are covered.

- [ ] **Step 5: Commit**

```bash
git add electron/workspace.cjs electron/workspace.test.cjs
git commit -m "feat(electron): debounced recursive watcher with error restart"
```

---

### Task 4: Main-process git module

**Files:**
- Create: `electron/git.cjs`
- Create: `electron/git.test.cjs`

- [ ] **Step 1: Write the failing tests**

Create `electron/git.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const git = require('./git.cjs');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} ${args.join(' ')} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function withRepo(t, fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'outlaw-git-'));
  t.after(() => fsp.rm(dir, { recursive: true, force: true }));
  try {
    await run('git', ['-C', dir, 'init', '-q']);
    await run('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
    await run('git', ['-C', dir, 'config', 'user.name', 'Test']);
  } catch (err) {
    t.skip(`git CLI unavailable: ${err.message}`);
    return;
  }
  await fn(dir);
}

test('status reports branch, staged, modified and untracked entries', async (t) => {
  await withRepo(t, async (dir) => {
    await fsp.writeFile(path.join(dir, 'committed.txt'), 'base\n');
    await run('git', ['-C', dir, 'add', '.']);
    await run('git', ['-C', dir, 'commit', '-qm', 'init']);
    await fsp.writeFile(path.join(dir, 'new.txt'), 'new\n');        // untracked
    await fsp.writeFile(path.join(dir, 'committed.txt'), 'base2\n'); // modified
    await fsp.writeFile(path.join(dir, 'staged.txt'), 's\n');         // to be staged
    await run('git', ['-C', dir, 'add', 'staged.txt']);

    const status = await git.status(dir);
    assert.notStrictEqual(status, null);
    assert.strictEqual(status.clean, false);
    const byPath = Object.fromEntries(status.files.map((f) => [f.path, f]));
    assert.strictEqual(byPath['new.txt'].status, 'untracked');
    assert.strictEqual(byPath['new.txt'].staged, false);
    assert.strictEqual(byPath['committed.txt'].status, 'modified');
    assert.strictEqual(byPath['committed.txt'].staged, false);
    assert.strictEqual(byPath['staged.txt'].status, 'added');
    assert.strictEqual(byPath['staged.txt'].staged, true);
    assert.strictEqual(typeof status.branch, 'string');
  });
});

test('status on clean repo reports clean', async (t) => {
  await withRepo(t, async (dir) => {
    await fsp.writeFile(path.join(dir, 'a.txt'), 'a\n');
    await run('git', ['-C', dir, 'add', '.']);
    await run('git', ['-C', dir, 'commit', '-qm', 'init']);
    const status = await git.status(dir);
    assert.strictEqual(status.clean, true);
    assert.strictEqual(status.files.length, 0);
  });
});

test('stage, commit, unstage roundtrip', async (t) => {
  await withRepo(t, async (dir) => {
    await fsp.writeFile(path.join(dir, 'x.txt'), 'x\n');
    await git.stage(dir, ['x.txt']);
    let status = await git.status(dir);
    assert.strictEqual(status.files[0].staged, true);
    await git.commit(dir, 'add x');
    status = await git.status(dir);
    assert.strictEqual(status.clean, true);
    await fsp.writeFile(path.join(dir, 'x.txt'), 'x2\n');
    await git.stage(dir, ['x.txt']);
    await git.unstage(dir, ['x.txt']);
    status = await git.status(dir);
    assert.strictEqual(status.files.find((f) => f.path === 'x.txt').staged, false);
  });
});

test('status paths are relative with forward slashes', async (t) => {
  await withRepo(t, async (dir) => {
    await fsp.mkdir(path.join(dir, 'src'));
    await fsp.writeFile(path.join(dir, 'src', 'a.ts'), 'a\n');
    await run('git', ['-C', dir, 'add', '.']);
    await run('git', ['-C', dir, 'commit', '-qm', 'init']);
    await fsp.writeFile(path.join(dir, 'src', 'a.ts'), 'b\n');
    const status = await git.status(dir);
    assert.strictEqual(status.files[0].path, 'src/a.ts');
  });
});

test('diff returns textual diff for a modified file', async (t) => {
  await withRepo(t, async (dir) => {
    await fsp.writeFile(path.join(dir, 'd.txt'), 'one\n');
    await run('git', ['-C', dir, 'add', '.']);
    await run('git', ['-C', dir, 'commit', '-qm', 'init']);
    await fsp.writeFile(path.join(dir, 'd.txt'), 'two\n');
    const diff = await git.diff(dir, 'd.txt');
    assert.strictEqual(diff.includes('-one'), true);
    assert.strictEqual(diff.includes('+two'), true);
  });
});
```

If a rename-related assertion is ever added and fails: `git status --porcelain=v1 -z` emits rename pairs as two consecutive NUL records — the test suite is the place to pin down which record is the new path on the installed git version, and the parser must match observed output.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:electron`
Expected: FAIL — `Cannot find module './git.cjs'`. (If git is missing on the machine the repo tests SKIP; report that, since the Electron build needs git.)

- [ ] **Step 3: Implement `electron/git.cjs`**

```js
/**
 * Git CLI wrapper for the main process. Spawns `git` with execFile argument
 * arrays (never a shell), always with `-C <root>` so operations are confined
 * to the opened workspace. Parses `status --porcelain=v1 -z -b` here so the
 * renderer never touches raw git output.
 */
const { execFile } = require('child_process');

function runGit(root, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, ...args], { maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

module.exports.isAvailable = async function isAvailable() {
  const res = await runGit('.', ['--version']);
  return res.ok;
};

const STATUS_MAP = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied' };

function parseBranchLine(line) {
  const branchMatch = line.match(/^## (?:No commits yet on )?([^\s.[\]]+)/);
  const ab = line.match(/ahead (\d+)/);
  const bb = line.match(/behind (\d+)/);
  return {
    branch: branchMatch ? branchMatch[1] : null,
    ahead: ab ? parseInt(ab[1], 10) : 0,
    behind: bb ? parseInt(bb[1], 10) : 0,
  };
}

module.exports.parseStatus = function parseStatus(porcelainOutput) {
  const records = porcelainOutput.split('\0').filter((r) => r.length > 0);
  let branch = null;
  let ahead = 0;
  let behind = 0;
  const files = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.startsWith('## ') || rec.startsWith('No commits yet on')) {
      const info = parseBranchLine(rec.startsWith('## ') ? rec.slice(3) : rec);
      branch = info.branch;
      ahead = info.ahead;
      behind = info.behind;
      continue;
    }
    if (rec.length < 4) continue;
    const xy = rec.slice(0, 2);
    const p = rec.slice(3).replace(/\\/g, '/');
    const entry = { path: p, status: 'modified', staged: false };
    if (xy === '??') {
      entry.status = 'untracked';
    } else if (xy === '!!') {
      entry.status = 'ignored';
    } else {
      const x = xy[0];
      const y = xy[1];
      entry.staged = x !== ' ';
      entry.status = STATUS_MAP[x !== ' ' ? x : y] || 'modified';
      if (x === 'R' || x === 'C') {
        // -z mode: the companion path is the next NUL record. The test suite
        // pins the pair order on the installed git version.
        i += 1;
        entry.origPath = records[i];
      }
    }
    files.push(entry);
  }
  return { branch, ahead, behind, files, clean: files.length === 0 };
};

module.exports.status = async function status(root) {
  const res = await runGit(root, ['status', '--porcelain=v1', '-z', '-b']);
  if (!res.ok) return null;
  return module.exports.parseStatus(res.stdout);
};

module.exports.stage = async function stage(root, paths) {
  const res = await runGit(root, ['add', '--', ...paths]);
  if (!res.ok) throw new Error(res.stderr || 'git add failed');
};

module.exports.unstage = async function unstage(root, paths) {
  const res = await runGit(root, ['reset', '-q', 'HEAD', '--', ...paths]);
  if (!res.ok) throw new Error(res.stderr || 'git reset failed');
};

module.exports.commit = async function commit(root, message) {
  const res = await runGit(root, ['commit', '-m', message, '--']);
  if (!res.ok) throw new Error(res.stderr || 'git commit failed');
};

module.exports.discard = async function discard(root, paths) {
  const res = await runGit(root, ['checkout', '--', ...paths]);
  if (!res.ok) throw new Error(res.stderr || 'git checkout failed');
};

module.exports.diff = async function diff(root, filePath) {
  const res = await runGit(root, ['diff', '--', filePath]);
  return res.stdout;
};

module.exports.branch = async function branch(root) {
  const status = await module.exports.status(root);
  return status ? status.branch : null;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add electron/git.cjs electron/git.test.cjs
git commit -m "feat(electron): git CLI module with structured porcelain parsing and node tests"
```

---

### Task 5: IPC wiring — main handlers, preload bridge

**Files:**
- Modify: `electron/main.cjs`
- Modify: `electron/preload.cjs`

- [ ] **Step 1: Add IPC handlers to `electron/main.cjs`**

Extend the first require line and add module requires at the top:

```js
const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const workspace = require('./workspace.cjs');
const git = require('./git.cjs');
```

Add a module-level `let mainWindow = null;` above `createMainWindow`, and inside `createMainWindow` change `const mainWindow = new BrowserWindow({ ... })` to `mainWindow = new BrowserWindow({ ... })`.

Add this block after the `createMainWindow` function definition:

```js
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
```

Call `installFsIpc();` inside the existing `app.whenReady().then(...)` block, immediately after `createMainWindow(...)`.

- [ ] **Step 2: Extend the preload bridge in `electron/preload.cjs`**

Replace the whole file with:

```js
const { contextBridge, ipcRenderer } = require('electron');

const aiProxyPrefix = '--outlaw-code-ai-proxy=';
const aiProxyTokenPrefix = '--outlaw-code-ai-proxy-token=';
const aiProxyArg = process.argv.find((arg) => arg.startsWith(aiProxyPrefix));
const aiProxyTokenArg = process.argv.find((arg) => arg.startsWith(aiProxyTokenPrefix));
const aiProxyBaseURL = aiProxyArg?.slice(aiProxyPrefix.length);
const aiProxyToken = aiProxyTokenArg?.slice(aiProxyTokenPrefix.length);

async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok === false) {
    const err = new Error(res.error.message);
    err.code = res.error.code;
    throw err;
  }
  return res ? res.value : undefined;
}

contextBridge.exposeInMainWorld('outlawCode', {
  platform: process.platform,
  aiProxyBaseURL,
  aiProxyToken,
  fs: {
    openFolder: (preselected) => call('fs:openFolder', preselected),
    readDir: (p) => call('fs:readDir', p),
    readFile: (p) => call('fs:readFile', p),
    writeFile: (p, content) => call('fs:writeFile', p, content),
    createEntry: (p, kind) => call('fs:createEntry', p, kind),
    rename: (from, to) => call('fs:rename', from, to),
    delete: (p) => call('fs:delete', p),
    search: (query, maxResults) => call('fs:search', query, maxResults),
    watch: () => call('fs:watch'),
    unwatch: () => call('fs:unwatch'),
  },
  git: {
    available: () => call('git:available'),
    status: () => call('git:status'),
    stage: (paths) => call('git:stage', paths),
    unstage: (paths) => call('git:unstage', paths),
    commit: (message) => call('git:commit', message),
    discard: (paths) => call('git:discard', paths),
    diff: (p) => call('git:diff', p),
  },
  onFsEvents: (callback) => {
    const listener = (_event, events) => callback(events);
    ipcRenderer.on('fs:watch:event', listener);
    return () => ipcRenderer.off('fs:watch:event', listener);
  },
});
```

- [ ] **Step 3: Verify**

Run: `npm run test:electron`
Expected: PASS.
Run: `node --check electron/main.cjs && node --check electron/preload.cjs`
Expected: no output (syntax OK).

- [ ] **Step 4: Commit**

```bash
git add electron/main.cjs electron/preload.cjs
git commit -m "feat(electron): fs/git IPC channels with serialized error envelopes"
```

---

### Task 6: Renderer FS contracts — types, stub sandbox extension, virtual provider

**Files:**
- Create: `src/lib/fs/types.ts`
- Create: `src/lib/fs/virtual-provider.ts`
- Modify: `src/lib/sandbox.ts` (extend `StubSandbox.files`)

- [ ] **Step 1: Create `src/lib/fs/types.ts`**

```ts
/**
 * The single filesystem contract every editor component consumes. Two
 * implementations exist: VirtualFsProvider (browser) and
 * ElectronFsProvider (desktop). Components never branch on mode — they
 * read `capabilities` instead.
 */
import type { StubSandbox } from '../sandbox';

export type FsEntryKind = 'file' | 'dir';

export interface FsEntry {
  name: string;
  path: string;
  kind: FsEntryKind;
}

export interface ReadDirResult {
  entries: FsEntry[];
  capped: boolean;
}

/**
 * fs.watch cannot distinguish "created" from "modified" without snapshot
 * state, and nothing in M1 needs that distinction — so the union is
 * 'changed' | 'deleted' (spec deviation, documented in the plan).
 */
export interface FsEvent {
  type: 'changed' | 'deleted';
  path: string;
}

export interface SearchQuery {
  query: string;
  maxResults?: number;
}

export interface SearchResult {
  path: string;
  line: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

export type FsErrorCode = 'ENOENT' | 'EISDIR' | 'OUTSIDE_ROOT' | 'EPERM' | 'EACCES';

export class FsError extends Error {
  code: FsErrorCode;
  constructor(code: FsErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'FsError';
  }
}

export interface FsCapabilities {
  local: boolean;
  watch: boolean;
}

export interface WorkspaceInfo {
  root: string;
  name: string;
  local: boolean;
}

export interface FileSystemProvider {
  readonly capabilities: FsCapabilities;
  readonly root: string | null;

  /** Electron: opens the native folder picker (or uses `preselected`). Returns the root, or null if canceled. Virtual: always null. */
  openFolder(preselected?: string): Promise<string | null>;
  readDir(path: string): Promise<ReadDirResult>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  createEntry(path: string, kind: FsEntryKind): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
  delete(path: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult[]>;
  watch(cb: (events: FsEvent[]) => void): Promise<void>;
  unwatch(): Promise<void>;
}

/** The sandbox shape the virtual provider needs (satisfied by StubSandbox after this task). */
export interface VirtualSandbox {
  id: string;
  files: StubSandbox['files'];
}
```

- [ ] **Step 2: Extend the stub sandbox**

In `src/lib/sandbox.ts`, change the `files` part of the `StubSandbox` interface to:

```ts
  files: {
    write: (path: string, content: string) => Promise<void>;
    read: (path: string) => Promise<string>;
    list: () => Promise<string[]>;
    remove: (path: string) => Promise<void>;
    rename: (from: string, to: string) => Promise<void>;
    exists: (path: string) => Promise<boolean>;
  };
```

And inside `createSandbox`, replace the `files: { ... }` block with:

```ts
    files: {
      async write(path: string, content: string) {
        files.set(path, content);
      },
      async read(path: string) {
        return files.get(path) ?? '';
      },
      async list() {
        return [...files.keys()];
      },
      async remove(path: string) {
        files.delete(path);
      },
      async rename(from: string, to: string) {
        const content = files.get(from);
        if (content === undefined) throw new Error(`ENOENT: ${from}`);
        files.delete(from);
        files.set(to, content);
      },
      async exists(path: string) {
        return files.has(path);
      },
    },
```

- [ ] **Step 3: Create `src/lib/fs/virtual-provider.ts`**

```ts
import { FsError } from './types';
import type { FileSystemProvider, FsEntry, ReadDirResult, FsCapabilities, SearchQuery, SearchResult, VirtualSandbox } from './types';
import { WORKSPACE_ROOT } from '../import-files';

const MAX_ENTRIES = 2000;
const MAX_SEARCH_RESULTS = 200;

export class VirtualFsProvider implements FileSystemProvider {
  readonly capabilities: FsCapabilities = { local: false, watch: false };
  readonly root = WORKSPACE_ROOT;

  constructor(private sandbox: VirtualSandbox) {}

  async openFolder(): Promise<string | null> {
    return null;
  }

  async readDir(dirPath: string): Promise<ReadDirResult> {
    const dir = dirPath.replace(/\/+$/, '');
    const prefix = dir ? `${dir}/` : '';
    const all = await this.sandbox.files.list();
    const dirs = new Set<string>();
    const names = new Set<string>();
    for (const p of all) {
      if (prefix && !p.startsWith(prefix)) continue;
      const rest = prefix ? p.slice(prefix.length) : p;
      if (!rest) continue;
      const first = rest.split('/')[0];
      names.add(first);
      if (rest.includes('/')) dirs.add(first);
    }
    const entries: FsEntry[] = [...names]
      .slice(0, MAX_ENTRIES)
      .map((name) => ({ name, path: prefix + name, kind: dirs.has(name) ? 'dir' : 'file' }));
    entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    return { entries, capped: names.size > MAX_ENTRIES };
  }

  async readFile(path: string): Promise<string> {
    if (!(await this.sandbox.files.exists(path))) {
      throw new FsError('ENOENT', `File not found: ${path}`);
    }
    return this.sandbox.files.read(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.sandbox.files.write(path, content);
  }

  async createEntry(path: string, kind: 'file' | 'dir'): Promise<void> {
    if (kind === 'file' && !(await this.sandbox.files.exists(path))) {
      await this.sandbox.files.write(path, '');
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.sandbox.files.rename(oldPath, newPath);
  }

  async delete(path: string): Promise<void> {
    const all = await this.sandbox.files.list();
    for (const p of all) {
      if (p === path || p.startsWith(`${path}/`)) await this.sandbox.files.remove(p);
    }
  }

  async search(query: SearchQuery): Promise<SearchResult[]> {
    const needle = query.query.toLowerCase();
    if (!needle) return [];
    const maxResults = query.maxResults ?? MAX_SEARCH_RESULTS;
    const results: SearchResult[] = [];
    const all = await this.sandbox.files.list();
    for (const p of all) {
      if (results.length >= maxResults) break;
      const content = await this.sandbox.files.read(p);
      const lines = content.split('\n');
      for (let i = 0; i < lines.length && results.length < maxResults; i++) {
        const idx = lines[i].toLowerCase().indexOf(needle);
        if (idx !== -1) {
          results.push({ path: p, line: i + 1, lineText: lines[i].slice(0, 300), matchStart: idx, matchEnd: idx + needle.length });
        }
      }
    }
    return results;
  }

  async watch(): Promise<void> {
    /* no external changes exist in virtual mode; the UI polls */
  }

  async unwatch(): Promise<void> {
    /* nothing to clean up */
  }
}
```

- [ ] **Step 4: Verify**

Run: `npm run lint:types`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/fs/types.ts src/lib/fs/virtual-provider.ts src/lib/sandbox.ts
git commit -m "feat(fs): provider contract + virtual provider over stub sandbox"
```

---

Continues in `docs/superpowers/plans/2026-09-27-electron-fs-git-part2.md` (Tasks 7–12).
