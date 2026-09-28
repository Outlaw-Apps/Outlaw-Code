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
