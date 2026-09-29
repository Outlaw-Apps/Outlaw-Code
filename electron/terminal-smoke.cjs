const { app } = require('electron');
const os = require('os');
const { createTerminalManager } = require('./terminal-manager.cjs');

const TIMEOUT_MS = 15000;
const PROMPT_PATTERN = /PS [^\r\n]*> /;

app.whenReady().then(() => {
  const manager = createTerminalManager({ pty: require('node-pty') });
  const stateMarker = `OUTLAW_STATE_${Date.now()}`;
  const interruptMarker = `OUTLAW_INTERRUPT_${Date.now()}`;
  const stateSplit = Math.floor(stateMarker.length / 2);
  const interruptSplit = Math.floor(interruptMarker.length / 2);
  let output = '';
  let settled = false;
  let shellName = 'PowerShell';
  let phase = 'boot';

  const finish = (code, message) => {
    if (settled) return;
    settled = true;
    manager.disposeAll();
    if (message) console.log(message);
    app.exit(code);
  };

  const timer = setTimeout(() => finish(1, `terminal smoke timed out in ${phase}; output=${JSON.stringify(output)}`), TIMEOUT_MS);
  const info = manager.create({
    ownerId: 1,
    cwd: os.tmpdir(),
    cols: 100,
    rows: 30,
    onData: ({ data }) => {
      const cursorQueries = data.split('\x1b[6n').length - 1;
      for (let i = 0; i < cursorQueries; i += 1) manager.write(info.id, 1, '\x1b[1;1R');
      output += data;
      if (phase === 'boot' && PROMPT_PATTERN.test(output)) {
        phase = 'set';
        output = '';
        manager.write(info.id, 1, `$env:OUTLAW_SMOKE='${stateMarker.slice(0, stateSplit)}' + '${stateMarker.slice(stateSplit)}'\r`);
        return;
      }
      if (phase === 'set' && PROMPT_PATTERN.test(output)) {
        phase = 'state';
        output = '';
        manager.write(info.id, 1, 'Write-Output $env:OUTLAW_SMOKE\r');
        return;
      }
      if (phase === 'state' && output.includes(stateMarker)) {
        phase = 'interrupt';
        output = '';
        manager.write(info.id, 1, 'Start-Sleep -Seconds 30\r');
        setTimeout(() => {
          manager.write(info.id, 1, '\x03');
          setTimeout(() => {
            manager.write(info.id, 1, `Write-Output ('${interruptMarker.slice(0, interruptSplit)}' + '${interruptMarker.slice(interruptSplit)}')\r`);
          }, 100);
        }, 250);
        return;
      }
      if (phase === 'interrupt' && output.includes(interruptMarker)) {
        clearTimeout(timer);
        finish(0, `terminal smoke OK (${shellName}; state + Ctrl+C)`);
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
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
