import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';
import type { AuthConfig } from '@scraper/shared';
import { createAuthSession, type PlaywrightChromium } from '../auth.js';
import { parseArgs, requireFlag } from './args.js';
import { headedChromium } from './chrome-profile.js';
import { collectDiscovery, type DiscoveryReport } from './discover-script.js';

const USAGE = `usage: npm run discover -- --url <url> [--cdp http://localhost:9222] [--profile] [--out <file.json>]

Open a page in the browser session that you already logged into, then report
the selectors that a scrape definition needs. It changes nothing on the page.

  --url      The page to inspect. Required.
  --cdp      Attach to a Chrome that runs with --remote-debugging-port.
  --profile  Copy the local Chrome profile instead. It needs no restart.
  --out      Where to write the JSON report. Default ./discovery-report.json
  --wait     A selector to wait for before the report. Useful for a slow grid.

Pass --cdp or --profile, not both. With neither, the page opens anonymously,
which shows the login page for any site behind a login.`;

export const DEFAULT_CHROME_USER_DATA_DIR = join(
  homedir(),
  'Library',
  'Application Support',
  'Google',
  'Chrome',
);

export interface DiscoverOptions {
  url: string;
  cdpEndpoint?: string;
  useProfile?: boolean;
  userDataDir?: string;
  profileDirectory?: string;
  outPath?: string;
  waitSelector?: string;
}

export interface DiscoverDeps {
  launchBrowser?: () => Promise<Browser>;
  chromium?: PlaywrightChromium;
  log?: (line: string) => void;
}

export class DiscoverError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'DiscoverError';
  }
}

export interface Suggestion {
  field: string;
  selector: string | null;
  evidence: string;
}

export function authForOptions(options: DiscoverOptions): AuthConfig {
  if (options.cdpEndpoint !== undefined && options.useProfile === true) {
    throw new DiscoverError('BAD_ARGUMENTS', 'pass --cdp or --profile, not both');
  }
  if (options.cdpEndpoint !== undefined) {
    return { mode: 'cdp', endpointUrl: options.cdpEndpoint };
  }
  if (options.useProfile === true) {
    const auth: Extract<AuthConfig, { mode: 'chromeProfile' }> = {
      mode: 'chromeProfile',
      userDataDir: options.userDataDir ?? DEFAULT_CHROME_USER_DATA_DIR,
    };
    if (options.profileDirectory !== undefined) auth.profileDirectory = options.profileDirectory;
    return auth;
  }
  return { mode: 'none' };
}

/**
 * Pick the grid that carries the most data rows. A CourtReserve page holds
 * layout tables as well, and the transactions table is the large one.
 */
function mainGridIndex(report: DiscoveryReport): number | null {
  let best: number | null = null;
  for (let i = 0; i < report.grids.length; i += 1) {
    const grid = report.grids[i];
    if (grid === undefined || grid.rowCount === 0) continue;
    const current = best === null ? undefined : report.grids[best];
    if (current === undefined || grid.rowCount > current.rowCount) best = i;
  }
  return best;
}

function gridSelector(report: DiscoveryReport, index: number): string {
  const grid = report.grids[index];
  if (grid === undefined) return '';
  if (grid.id.length > 0) return `#${grid.id}`;
  const kendo = grid.classes.find((name) => name === 'k-grid');
  if (kendo !== undefined) return '.k-grid';
  const first = grid.classes[0];
  return first === undefined ? grid.tag : `${grid.tag}.${first}`;
}

/** The control a person most likely means by "the Receipt button". */
function receiptControl(report: DiscoveryReport, gridIndex: number) {
  const inGrid = report.rowControls.filter((control) => control.gridIndex === gridIndex);
  const named = inGrid.find((control) => /receipt/i.test(control.text));
  return named ?? inGrid[0];
}

function controlSelector(control: { tag: string; id: string; classes: string[] }): string {
  if (control.id.length > 0) return `#${control.id}`;
  const useful = control.classes.filter((name) => !name.startsWith('k-state-'));
  if (useful.length === 0) return control.tag;
  return `${control.tag}.${useful.join('.')}`;
}

export function suggestions(report: DiscoveryReport): Suggestion[] {
  const out: Suggestion[] = [];
  const gridIndex = mainGridIndex(report);

  if (gridIndex === null) {
    out.push({
      field: 'rowSelector',
      selector: null,
      evidence: 'no grid on the page holds a data row. Check that you are logged in.',
    });
    return out;
  }

  const grid = report.grids[gridIndex];
  if (grid === undefined) return out;
  const base = gridSelector(report, gridIndex);
  out.push({
    field: 'rowSelector',
    selector: `${base} ${grid.rowSelector}`,
    evidence:
      `grid ${gridIndex} holds ${grid.rowCount} data row(s)` +
      (grid.headers.length > 0 ? ` under the headers ${grid.headers.join(' | ')}` : ''),
  });

  // A Kendo pager gives every arrow the class `k-pager-nav`, the previous one
  // included, so the class alone proves nothing. Only the label and the
  // direction icon tell next from previous.
  const isNext = (control: { title: string | null; ariaLabel: string | null; text: string; classes: string[] }) =>
    /next/i.test(control.title ?? '') ||
    /next/i.test(control.ariaLabel ?? '') ||
    control.classes.includes('k-i-arrow-e') ||
    control.classes.includes('k-i-arrow-60-right') ||
    control.text === '>' ||
    control.text === '›' ||
    /^next\b/i.test(control.text);

  const pagerControl = report.pagers
    .flatMap((pager) => pager.controls.map((control) => ({ pager, control })))
    .find(({ control }) => isNext(control));
  if (pagerControl === undefined) {
    out.push({
      field: 'nextSelector',
      selector: null,
      evidence: 'no pager control looks like a next arrow',
    });
  } else {
    const pagerBase =
      pagerControl.pager.id.length > 0
        ? `#${pagerControl.pager.id}`
        : `.${pagerControl.pager.classes[0] ?? 'k-pager-wrap'}`;
    const title = pagerControl.control.title;
    const selector =
      title !== null && title.length > 0
        ? `${pagerBase} ${pagerControl.control.tag}[title="${title}"]`
        : `${pagerBase} ${controlSelector(pagerControl.control)}`;
    out.push({
      field: 'nextSelector',
      selector,
      evidence:
        `pager control text ${JSON.stringify(pagerControl.control.text)}` +
        (title === null ? '' : `, title ${JSON.stringify(title)}`) +
        `, classes ${pagerControl.control.classes.join(' ') || '(none)'}`,
    });
  }

  const control = receiptControl(report, gridIndex);
  if (control === undefined) {
    out.push({
      field: 'receipt control',
      selector: null,
      evidence: 'the first data row holds no link and no button',
    });
    return out;
  }

  const usableHref =
    control.href !== null && control.href.length > 0 && !control.href.startsWith('javascript:');
  out.push({
    field: 'receipt control',
    selector: controlSelector(control),
    evidence:
      `${control.tag} with text ${JSON.stringify(control.text)}; ` +
      (usableHref
        ? `href ${JSON.stringify(control.href)} — use the openLink shape (courtreserve-receipts.json)`
        : `no usable href${control.hasHandler ? ' but it carries a handler' : ''}` +
          ` — use the click/newTab shape (courtreserve-receipts-newtab.json)`) +
      (control.newTab ? '; it opens a new tab (target=_blank)' : ''),
  });

  return out;
}

function section(log: (line: string) => void, title: string): void {
  log('');
  log(title);
  log('-'.repeat(title.length));
}

export function formatReport(report: DiscoveryReport, log: (line: string) => void): void {
  log(`page:  ${report.title}`);
  log(`url:   ${report.url}`);

  section(log, `grids (${report.grids.length})`);
  if (report.grids.length === 0) log('  none');
  report.grids.forEach((grid, index) => {
    log(`  [${index}] <${grid.tag}> id=${grid.id || '(none)'}`);
    log(`       classes: ${grid.classes.join(' ') || '(none)'}`);
    log(`       headers: ${grid.headers.join(' | ') || '(none)'}`);
    log(`       rows:    ${grid.rowCount} matched by ${grid.rowSelector}`);
  });

  section(log, `controls in the first data row (${report.rowControls.length})`);
  if (report.rowControls.length === 0) log('  none');
  for (const control of report.rowControls) {
    log(`  grid[${control.gridIndex}] <${control.tag}> ${JSON.stringify(control.text)}`);
    log(`       id=${control.id || '(none)'} classes=${control.classes.join(' ') || '(none)'}`);
    log(
      `       href=${control.href === null ? '(none)' : JSON.stringify(control.href)}` +
        ` target=${control.target === null ? '(none)' : control.target}` +
        ` newTab=${control.newTab} handler=${control.hasHandler}`,
    );
  }

  section(log, `pagers (${report.pagers.length})`);
  if (report.pagers.length === 0) log('  none');
  for (const pager of report.pagers) {
    log(`  <${pager.tag}> id=${pager.id || '(none)'} classes=${pager.classes.join(' ') || '(none)'}`);
    for (const control of pager.controls) {
      log(
        `       ${JSON.stringify(control.text)} classes=${control.classes.join(' ') || '(none)'}` +
          ` title=${control.title === null ? '(none)' : JSON.stringify(control.title)}` +
          ` disabled=${control.disabled}`,
      );
    }
  }

  section(log, `tab strips (${report.tabStrips.length})`);
  if (report.tabStrips.length === 0) log('  none');
  for (const strip of report.tabStrips) {
    log(`  <${strip.tag}> id=${strip.id || '(none)'} classes=${strip.classes.join(' ') || '(none)'}`);
    for (const item of strip.items) {
      log(`       ${JSON.stringify(item.text)} active=${item.active}`);
    }
  }

  section(log, `date inputs (${report.dateInputs.length})`);
  if (report.dateInputs.length === 0) log('  none');
  for (const input of report.dateInputs) {
    log(
      `  id=${input.id || '(none)'} name=${input.name || '(none)'} type=${input.type}` +
        ` value=${JSON.stringify(input.value)} placeholder=${JSON.stringify(input.placeholder)}`,
    );
    log(`       classes: ${input.classes.join(' ') || '(none)'}`);
  }

  section(log, 'suggested selectors');
  for (const suggestion of suggestions(report)) {
    log(`  ${suggestion.field}: ${suggestion.selector ?? '(not found)'}`);
    log(`       evidence: ${suggestion.evidence}`);
  }
}

export async function discover(
  options: DiscoverOptions,
  deps: DiscoverDeps = {},
): Promise<DiscoveryReport> {
  const log = deps.log ?? ((line: string) => console.log(line)); // eslint-disable-line no-console
  const auth = authForOptions(options);

  // A bot filter blocks a headless browser, so every mode that opens its own
  // window opens a visible one. `cdp` reuses the window the user already has.
  const headed = auth.mode !== 'cdp';
  const launch = deps.launchBrowser ?? (() => chromium.launch({ headless: !headed }));
  const browser = await launch();
  let session;
  try {
    session = await createAuthSession(auth, {
      browser,
      chromium: headedChromium(deps.chromium ?? chromium),
      allowCdp: true,
      allowLocalProfile: true,
      secrets: {},
    });
  } catch (err) {
    await browser.close().catch(() => {});
    throw new DiscoverError('BROWSER_UNREACHABLE', (err as Error).message);
  }

  try {
    const page = await session.context.newPage();
    await page.goto(options.url, { waitUntil: 'load' });
    if (options.waitSelector !== undefined) {
      await page.waitForSelector(options.waitSelector, { timeout: 20_000 }).catch(() => {
        log(`warning: --wait selector never appeared: ${options.waitSelector}`);
      });
    }
    const report = await page.evaluate(collectDiscovery);
    await page.close().catch(() => {});

    formatReport(report, log);

    const outPath = isAbsolute(options.outPath ?? '')
      ? (options.outPath as string)
      : resolve(process.cwd(), options.outPath ?? 'discovery-report.json');
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    log('');
    log(`wrote the JSON report to ${outPath}`);
    return report;
  } finally {
    await session.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

export const BROWSER_HELP = `
The browser session was not reachable. Two ways to give it one:

1. Chrome DevTools Protocol (--cdp). Quit Chrome COMPLETELY first: press
   Cmd+Q, or Chrome menu > Quit Google Chrome. A --remote-debugging-port flag
   passed while Chrome already runs opens a window in the existing process and
   does NOT open the port. Then:

     open -a "Google Chrome" --args --remote-debugging-port=9222

   Log in to the site in that window, then run this command again with
   --cdp http://localhost:9222

2. A copy of the Chrome profile (--profile). It needs no restart:

     npm run discover -- --url <url> --profile

   It copies ${DEFAULT_CHROME_USER_DATA_DIR}
   to a temporary folder and drives the copy.`;

export async function main(argv: string[], deps: DiscoverDeps = {}): Promise<number> {
  let options: DiscoverOptions;
  try {
    const args = parseArgs(argv);
    if (args.switches.has('help')) {
      // eslint-disable-next-line no-console
      console.log(USAGE);
      return 0;
    }
    options = { url: requireFlag(args, 'url') };
    if (args.flags.cdp !== undefined) options.cdpEndpoint = args.flags.cdp;
    if (args.switches.has('cdp')) options.cdpEndpoint = 'http://localhost:9222';
    if (args.switches.has('profile')) options.useProfile = true;
    if (args.flags.profile !== undefined) {
      options.useProfile = true;
      options.profileDirectory = args.flags.profile;
    }
    if (args.flags['user-data-dir'] !== undefined) options.userDataDir = args.flags['user-data-dir'];
    if (args.flags.out !== undefined) options.outPath = args.flags.out;
    if (args.flags.wait !== undefined) options.waitSelector = args.flags.wait;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error BAD_ARGUMENTS: ${(err as Error).message}`);
    // eslint-disable-next-line no-console
    console.error(USAGE);
    return 2;
  }

  try {
    await discover(options, deps);
    return 0;
  } catch (err) {
    const code = err instanceof DiscoverError ? err.code : 'UNKNOWN';
    // eslint-disable-next-line no-console
    console.error(`error ${code}: ${(err as Error).message}`);
    if (code === 'BROWSER_UNREACHABLE') {
      // eslint-disable-next-line no-console
      console.error(BROWSER_HELP);
    }
    return 1;
  }
}

const isMain = process.argv[1]?.endsWith('discover.js');
if (isMain) {
  process.exit(await main(process.argv.slice(2)));
}
