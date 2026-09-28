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
