const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');
const envFiles = [
  '.env',
  '.env.local',
  '.env.production',
  '.env.production.local',
  '.env.web',
  '.env.web.local',
];

function readCandidateSecrets() {
  const candidates = [];

  for (const envFile of envFiles) {
    const envPath = path.join(root, envFile);
    if (!fs.existsSync(envPath)) continue;

    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*VITE_OPENAI_API_KEY\s*=(.*)$/);
      if (!match) continue;

      let value = match[1].trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1).trim();
      }

      if (value.length >= 8) candidates.push({ envFile, value });
    }
  }

  return candidates;
}

function listFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  });
}

if (!fs.existsSync(distDir)) {
  console.error('check-web-bundle-secrets: FAIL — dist/ is missing. Build the web bundle first.');
  process.exit(1);
}

const candidates = readCandidateSecrets();
for (const distFile of listFiles(distDir)) {
  const contents = fs.readFileSync(distFile, 'utf8');
  for (const { envFile, value } of candidates) {
    if (!contents.includes(value)) continue;

    const relativeDistPath = path.relative(root, distFile).split(path.sep).join('/');
    console.error(
      `check-web-bundle-secrets: FAIL — a VITE_OPENAI_API_KEY value from ${envFile} is embedded in ${relativeDistPath}. Build the web bundle with \`npm run build:web\` (which loads .env.web) and never put real keys in .env.web.`,
    );
    process.exit(1);
  }
}

console.log('check-web-bundle-secrets: OK — no VITE_OPENAI_API_KEY values found in dist/');
