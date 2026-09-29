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
