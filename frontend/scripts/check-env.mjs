/* ---------------------------------------------------------------------------
   Prebuild guard — FIX FOR FAILURE MODE 1.

   VITE_* variables are substituted into the bundle at build time. If
   VITE_API_BASE_URL is empty, the app falls back to its in-memory mock API and
   still looks completely functional — which means a broken deployment is
   indistinguishable from a working one until someone checks the network tab.

   So the build now refuses to run rather than producing that artefact silently.
   Demo builds are still possible, but you have to say so out loud:

     npm run build        production — requires a real API base URL
     npm run build:demo   explicitly builds the mock-data demo

   Exits non-zero to stop the build.
   --------------------------------------------------------------------------- */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const allowMock = process.argv.includes('--allow-mock');

/** Minimal .env reader — Vite loads these itself, we just need to see them. */
function readEnvFile(name) {
  const path = join(root, name);
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const eq = line.indexOf('=');
        if (eq === -1) return null;
        return [line.slice(0, eq).trim(), line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')];
      })
      .filter(Boolean)
  );
}

const env = { ...readEnvFile('.env'), ...readEnvFile('.env.production'), ...process.env };

const apiBase = (env.VITE_API_BASE_URL ?? '').trim();
const authMode = (env.VITE_AUTH_MODE ?? 'mock').trim();

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

const problems = [];

if (!apiBase) {
  problems.push(
    'VITE_API_BASE_URL is empty — the build would ship the in-memory mock API.'
  );
} else if (!/^https?:\/\//.test(apiBase)) {
  problems.push(`VITE_API_BASE_URL is not a URL: "${apiBase}"`);
} else if (apiBase.endsWith('/')) {
  problems.push(
    `VITE_API_BASE_URL must not end with a slash (paths are appended): "${apiBase}"`
  );
}

if (authMode === 'mock') {
  problems.push('VITE_AUTH_MODE is "mock" — nobody can actually sign in.');
} else if (!['cognito', 'api'].includes(authMode)) {
  problems.push(`VITE_AUTH_MODE must be mock, cognito, or api — got "${authMode}".`);
}

if (authMode === 'cognito') {
  if (!env.VITE_COGNITO_USER_POOL_ID) problems.push('VITE_COGNITO_USER_POOL_ID is not set.');
  if (!env.VITE_COGNITO_CLIENT_ID) problems.push('VITE_COGNITO_CLIENT_ID is not set.');
}

/* Anything that looks like a real AWS credential must never reach the bundle. */
const leaked = Object.keys(env).filter(
  (k) =>
    k.startsWith('VITE_') &&
    /(SECRET|ACCESS_KEY|PASSWORD|PRIVATE|CONNECTION_STRING)/i.test(k)
);
if (leaked.length) {
  console.error(red('\n  BUILD BLOCKED — secret-looking variable in the client bundle\n'));
  leaked.forEach((k) => console.error(`    ${k}`));
  console.error(
    dim(
      '\n  Every VITE_ variable is compiled into public JavaScript. Move these to the\n' +
        '  Lambda environment or AWS Secrets Manager, on the backend side of the wall.\n'
    )
  );
  process.exit(1);
}

if (problems.length === 0) {
  console.log(green('✓ env check passed') + dim(`  api=${apiBase}  auth=${authMode}`));
  process.exit(0);
}

if (allowMock) {
  console.log(yellow('\n  Building the DEMO bundle (mock data, no backend).\n'));
  problems.forEach((p) => console.log(dim(`    · ${p}`)));
  console.log(
    dim('\n  Fine for a preview or a design review. Do NOT submit this build.\n')
  );
  process.exit(0);
}

console.error(red('\n  BUILD BLOCKED — this would deploy as a fake three-tier app\n'));
problems.forEach((p) => console.error(`    · ${p}`));
console.error(`
  The client would fall back to its in-memory mock API and look completely
  functional, so nothing would tell you — or a marker — that the backend was
  never being called.

  ${green('To build for real:')}  set these in .env (or your host's build
  environment) and run ${green('npm run build')} again:

      VITE_API_BASE_URL=https://<api-id>.execute-api.ap-southeast-2.amazonaws.com/prod
      VITE_AUTH_MODE=cognito
      VITE_COGNITO_USER_POOL_ID=ap-southeast-2_xxxxxxxxx
      VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx

  ${yellow('To build the demo on purpose:')}  ${yellow('npm run build:demo')}
`);
process.exit(1);
