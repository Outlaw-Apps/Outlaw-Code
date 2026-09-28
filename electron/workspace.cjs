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
