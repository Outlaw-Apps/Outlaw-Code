const { spawn, spawnSync } = require('child_process');
const http = require('http');

const devServerUrl = 'http://127.0.0.1:3000';
const electronBinary = require('electron');
const isWindows = process.platform === 'win32';

let viteProcess;
let electronProcess;

function waitForServer(url, attemptsRemaining = 60) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      response.resume();
      resolve();
    });

    request.on('error', () => {
      if (attemptsRemaining <= 1) {
        reject(new Error(`Vite did not start at ${url}`));
        return;
      }

      setTimeout(() => {
        waitForServer(url, attemptsRemaining - 1).then(resolve, reject);
      }, 500);
    });
  });
}

function killTree(child) {
  if (!child || !child.pid || child.killed || child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (isWindows) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  } else {
    child.kill();
  }
}

function stopProcesses() {
  killTree(electronProcess);
  killTree(viteProcess);
}

async function start() {
  viteProcess = spawn('npm run dev', {
    stdio: 'inherit',
    shell: true,
  });

  viteProcess.on('exit', (code) => {
    if (code !== 0) {
      killTree(electronProcess);
    }
  });

  await waitForServer(devServerUrl);

  electronProcess = spawn(electronBinary, ['.'], {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devServerUrl,
    },
  });

  electronProcess.on('exit', (code) => {
    stopProcesses();
    process.exit(code ?? 0);
  });
}

process.on('SIGINT', () => {
  stopProcesses();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stopProcesses();
  process.exit(0);
});

start().catch((error) => {
  console.error(error);
  stopProcesses();
  process.exit(1);
});

