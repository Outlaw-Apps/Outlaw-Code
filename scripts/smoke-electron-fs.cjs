/**
 * Headless smoke check for the main-process workspace/git modules.
 * Runs the same modules the Electron app uses, against a temp folder.
 */
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const ws = require('../electron/workspace.cjs');
const git = require('../electron/git.cjs');

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${stderr || err.message}`));
      else resolve(stdout);
    });
  });
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'outlaw-smoke-'));
  ws.setRoot(dir);

  await ws.writeFile('smoke.txt', 'alpha');
  if ((await ws.readFile('smoke.txt')) !== 'alpha') throw new Error('roundtrip failed');
  await ws.rename('smoke.txt', 'renamed.txt');
  await ws.createEntry('deep/nested/dir', 'dir');
  const { entries } = await ws.readDir('.');
  if (!entries.some((e) => e.name === 'renamed.txt')) throw new Error('rename not visible');

  let escaped = false;
  try {
    await ws.readFile(path.join('..', 'outside.txt'));
  } catch {
    escaped = true;
  }
  if (!escaped) throw new Error('path confinement FAILED - outside reads were allowed');

  const gitOk = await git.isAvailable();
  console.log(`git available: ${gitOk}`);
  if (gitOk) {
    await run('git', ['-C', dir, 'init', '-q']);
    await run('git', ['-C', dir, 'config', 'user.email', 'smoke@example.com']);
    await run('git', ['-C', dir, 'config', 'user.name', 'Smoke']);
    await fsp.writeFile(path.join(dir, 'g.txt'), '1');
    await git.stage(dir, ['g.txt']);
    await git.commit(dir, 'smoke commit');
    const status = await git.status(dir);
    if (!status || status.files.some((f) => f.path === 'g.txt')) throw new Error('g.txt not committed');
  }

  ws.setRoot(null);
  await fsp.rm(dir, { recursive: true, force: true });
  console.log('smoke OK');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
