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
    await fsp.writeFile(path.join(dir, 'staged.txt'), 's\n');        // to be staged
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
