#!/usr/bin/env node
// The one-command CourtReserve receipts job.
//
//   npm run job:receipts -- --out ./exports/receipts
//
// It runs definitions/courtreserve-receipts.json through the Phase 5 local
// runner, in the Chrome session that the user already logged in to. It writes
// a PNG and a PDF of every receipt into the output folder. It needs no
// Postgres, no Redis and no MinIO.
//
// The selectors in the definition are unverified Kendo defaults until
// `npm run discover` confirms them.

import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

const requireFromWorker = createRequire(join(repoRoot, 'apps/worker/package.json'));
const { chromium } = requireFromWorker('playwright');
const { runLocal, CliError } = await import(
  join(repoRoot, 'apps/worker/dist/cli/run-local.js')
);
const { StepError } = await import(join(repoRoot, 'apps/worker/dist/interpreter.js'));
const { headedChromium } = await import(
  join(repoRoot, 'apps/worker/dist/cli/chrome-profile.js')
);

const DEFAULT_DEFINITION = 'definitions/courtreserve-receipts.json';
const DEFAULT_CDP = 'http://localhost:9222';
const CHROME_USER_DATA_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
);

const USAGE = `usage: npm run job:receipts -- --out <folder> [options]

  --out         Where to write the receipts. Required.
  --definition  The definition file. Default ${DEFAULT_DEFINITION}
  --url         Override the URL that the definition carries.
  --cdp <url>   The Chrome debug endpoint. Default ${DEFAULT_CDP}
  --profile     Copy the local Chrome profile instead of attaching over CDP.
                It needs no Chrome restart. It always opens a visible window,
                because Cloudflare blocks a headless browser.
  --timeout     Override the run timeout, in milliseconds.`;

const CDP_HELP = `
Chrome was not reachable on the debug endpoint. Fix it like this:

  1. Quit Chrome COMPLETELY. Press Cmd+Q, or use the Chrome menu and choose
     "Quit Google Chrome". Closing the window is not enough.

     To check that no Chrome process is left:
       pgrep -x "Google Chrome"

  2. Start Chrome with the debug port open:
       open -a "Google Chrome" --args --remote-debugging-port=9222

     A --remote-debugging-port flag passed while Chrome already runs opens a
     new window in the existing process and does NOT open the port.

  3. Confirm the port answers:
       curl -s http://localhost:9222/json/version

  4. Log in to CourtReserve in that Chrome window, then run this job again.

Or skip the restart and use a copy of your Chrome profile:

  npm run job:receipts -- --out <folder> --profile

That reads ${CHROME_USER_DATA_DIR}.
Close Chrome's tabs on the site first if the copy comes out logged out.`;

function parse(argv) {
  const flags = {};
  const switches = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const name = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      switches.add(name);
      continue;
    }
    flags[name] = next;
    i += 1;
  }
  return { flags, switches };
}

function authFor(args) {
  if (args.switches.has('profile') || args.flags.profile !== undefined) {
    const auth = { mode: 'chromeProfile', userDataDir: CHROME_USER_DATA_DIR };
    if (args.flags.profile !== undefined) auth.profileDirectory = args.flags.profile;
    return auth;
  }
  return { mode: 'cdp', endpointUrl: args.flags.cdp ?? DEFAULT_CDP };
}

/** A CDP connection failure is the one error this job must explain in full. */
function looksLikeCdpFailure(message) {
  return /ECONNREFUSED|connect ECONNREFUSED|9222|browserType\.connectOverCDP|WebSocket|ENOTFOUND/i.test(
    message,
  );
}

async function main(argv) {
  const args = parse(argv);
  if (args.switches.has('help')) {
    console.log(USAGE);
    return 0;
  }

  const outDir = args.flags.out;
  if (outDir === undefined) {
    console.error('error BAD_ARGUMENTS: --out is required');
    console.error(USAGE);
    return 2;
  }

  const definitionArg = args.flags.definition ?? DEFAULT_DEFINITION;
  const definitionPath = isAbsolute(definitionArg)
    ? definitionArg
    : resolve(repoRoot, definitionArg);

  let shipped;
  try {
    shipped = JSON.parse(await readFile(definitionPath, 'utf8'));
  } catch (err) {
    console.error(`error BAD_DEFINITION: cannot read ${definitionPath}: ${err.message}`);
    return 1;
  }

  const auth = authFor(args);
  const config = { ...shipped.config, auth };
  const url = args.flags.url ?? shipped.url;

  // The runner reads a file, so the auth override goes back to disk first.
  const workDir = await mkdtemp(join(tmpdir(), 'job-receipts-'));
  const patchedPath = join(workDir, 'definition.json');
  await writeFile(patchedPath, JSON.stringify({ url, config }), 'utf8');

  console.log(`definition: ${definitionPath}`);
  console.log(`url:        ${url}`);
  console.log(
    `session:    ${auth.mode === 'cdp' ? `cdp ${auth.endpointUrl}` : `chromeProfile ${auth.userDataDir}`}`,
  );
  console.log('');

  const options = {
    definitionPath: patchedPath,
    outDir,
    url,
    // Both session modes build their own context, so this browser is never
    // navigated. The window that matters is the one headedChromium opens.
    headed: args.switches.has('headed'),
    allowCdp: true,
    allowLocalProfile: true,
  };
  if (args.flags.timeout !== undefined)
    options.timeoutMs = Number.parseInt(args.flags.timeout, 10);

  try {
    const result = await runLocal(options, {
      launchBrowser: (headed) => chromium.launch({ headless: !headed }),
      chromium: headedChromium(chromium),
    });
    console.log('');
    console.log(`done: ${result.files.length} file(s) in ${result.outDir}`);
    return 0;
  } catch (err) {
    const message = err.message ?? String(err);
    const unreachable = looksLikeCdpFailure(message);
    const code = unreachable
      ? 'BROWSER_UNREACHABLE'
      : err instanceof CliError || err instanceof StepError
        ? err.code
        : (err.name ?? 'UNKNOWN');
    console.error(`error ${code}: ${message.split('\n')[0]}`);

    if (auth.mode === 'cdp' && (code === 'AUTH_FAILED' || unreachable)) {
      console.error(CDP_HELP);
    } else if (
      code === 'SELECTOR_NOT_FOUND' ||
      /Timeout|waiting for locator/i.test(message)
    ) {
      console.error(`
A selector did not match. Every selector in the definition is an unverified
Kendo UI default until you confirm it. Run the discovery report against the
same session and compare:

  npm run discover -- --url "${url}" ${
    auth.mode === 'cdp' ? `--cdp ${auth.endpointUrl}` : '--profile'
  }

Then edit ${definitionPath} with the selectors the report names.`);
    }
    return 1;
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

process.exit(await main(process.argv.slice(2)));
