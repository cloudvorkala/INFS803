/* ---------------------------------------------------------------------------
   Post-build step — FIX FOR FAILURE MODE 2.

   This is a single-page app: the browser asks the host for /orders, and there
   is no object at that key, so a plain static host returns 404. The host has to
   be told to serve index.html for unmatched paths.

   Some of that is host configuration (CloudFront error responses, an Amplify
   rewrite rule) and lives in DEPLOYMENT.md. But two parts can ship with the
   build itself, so they cannot be forgotten:

     1. dist/404.html — a byte copy of index.html. S3 static website hosting,
        GitHub Pages, and several other hosts serve this automatically for
        unmatched paths, which fixes deep links with no configuration at all.

     2. dist/_redirects — read by Amplify (and Netlify) as a rewrite rule, so
        the fix travels with the artefact rather than living only in a console
        setting somebody has to remember to click.

   Also prints the deploy checklist, because the moment after a build is when
   somebody is about to deploy.
   --------------------------------------------------------------------------- */

import { readFileSync, writeFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

if (!existsSync(join(dist, 'index.html'))) {
  console.error('post-build: dist/index.html is missing — did vite build run?');
  process.exit(1);
}

const indexHtml = readFileSync(join(dist, 'index.html'), 'utf8');

// 1. SPA fallback document
writeFileSync(join(dist, '404.html'), indexHtml);

// 2. Rewrite rule for hosts that read it
writeFileSync(join(dist, '_redirects'), '/*    /index.html   200\n');

/* --- Report ---------------------------------------------------------------- */

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function dirSize(dir) {
  let total = 0;
  let count = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = dirSize(full);
      total += sub.total;
      count += sub.count;
    } else {
      total += statSync(full).size;
      count += 1;
    }
  }
  return { total, count };
}

const { total, count } = dirSize(dist);
const covers = existsSync(join(dist, 'covers')) ? readdirSync(join(dist, 'covers')).length : 0;
const isDemo = !indexHtml.includes('execute-api') && process.argv.includes('--demo');

console.log(green('✓ post-build'));
console.log(dim(`  dist/404.html      SPA fallback (S3 website hosting, GitHub Pages)`));
console.log(dim(`  dist/_redirects    rewrite rule (Amplify, Netlify)`));
console.log(dim(`  ${count} files, ${(total / 1024).toFixed(0)} KB total${covers ? `, ${covers} cover images` : ''}`));

console.log(`
  ${yellow('Before this goes live:')}
    · CloudFront users — add custom error responses mapping BOTH 403 and 404
      to /index.html with status 200. With Origin Access Control a missing key
      returns 403, not 404, so mapping only 404 leaves deep links broken.
    · Amplify users — the _redirects file covers it; confirm under
      App settings -> Rewrites and redirects.
    · Check the deployed site has no orange mock-data banner.
    · Paste a deep link (/books/bk-001) into a fresh tab and confirm it loads.
${isDemo ? `\n  ${yellow('This is a DEMO build — mock data. Do not submit it.')}\n` : ''}`);
