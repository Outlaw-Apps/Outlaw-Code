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
