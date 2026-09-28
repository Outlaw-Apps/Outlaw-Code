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
  const branchMatch = line.match(/^(?:No commits yet on )?([^\s.[\]]+)/);
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
