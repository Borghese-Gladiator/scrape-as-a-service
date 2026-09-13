import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import type { Browser } from 'playwright';
import type { ScrapeConfig } from '@scraper/shared';
import { assertSafeUrl, validateScrapeConfig } from '@scraper/shared';
import { artifactFilename } from '../artifacts.js';
import { StepError } from '../interpreter.js';
import { runScrape, type ScrapeDeps } from '../scrape.js';
import { integerFlag, parseArgs, requireFlag } from './args.js';

const USAGE = `usage: npm run run-local -- --definition <file.json> --out <folder> [--url <url>] [--headed] [--timeout <ms>]

Run one scrape definition end to end with a real browser. It needs no Postgres,
no Redis, and no MinIO: every artifact lands in the output folder.

  --definition     A JSON file. Either { name?, url, config } or a bare config.
  --out            The output folder. It is created when it is missing.
  --url            Override the URL that the definition carries.
  --headed         Show the browser. The default is headless.
  --timeout        Override limits.maxDurationMs, in milliseconds.
  --allow-private  Let the run reach a loopback or private URL. Fixtures need it.
  --allow-cdp      Let auth.mode=cdp attach to a Chrome that already runs.
  --allow-profile  Let auth.mode=chromeProfile copy a Chrome profile.`;

export interface RunLocalOptions {
  definitionPath: string;
  outDir: string;
  url?: string;
  headed?: boolean;
  timeoutMs?: number;
  /** Turn the address half of the SSRF guard off. A local fixture needs it. */
  allowPrivateUrls?: boolean;
  allowCdp?: boolean;
  allowLocalProfile?: boolean;
}

export interface RunLocalDeps {
  launchBrowser: (headed: boolean) => Promise<Browser>;
  log?: (line: string) => void;
}

export interface RunLocalResult {
  url: string;
  outDir: string;
  files: { name: string; type: string; bytes: number }[];
}

export class CliError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'CliError';
  }
}

interface DefinitionFile {
  url?: string;
  config: unknown;
}

/** Accept a stored definition and a bare config, so either file shape works. */
function readDefinitionFile(raw: string, path: string): DefinitionFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CliError('BAD_DEFINITION', `${path} is not valid JSON: ${(err as Error).message}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new CliError('BAD_DEFINITION', `${path} must hold a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  if (record.config !== undefined) {
    const file: DefinitionFile = { config: record.config };
    if (typeof record.url === 'string') file.url = record.url;
    return file;
  }
  return { config: record };
}

function applyTimeout(config: ScrapeConfig, timeoutMs: number | undefined): ScrapeConfig {
  if (timeoutMs === undefined) return config;
  return { ...config, limits: { ...config.limits, maxDurationMs: timeoutMs } };
}

export async function runLocal(
  options: RunLocalOptions,
  deps: RunLocalDeps,
): Promise<RunLocalResult> {
  const log = deps.log ?? ((line: string) => console.log(line)); // eslint-disable-line no-console
  const definitionPath = isAbsolute(options.definitionPath)
    ? options.definitionPath
    : resolve(process.cwd(), options.definitionPath);

  let raw: string;
  try {
    raw = await readFile(definitionPath, 'utf8');
  } catch (err) {
    throw new CliError('BAD_DEFINITION', `cannot read ${definitionPath}: ${(err as Error).message}`);
  }

  const file = readDefinitionFile(raw, definitionPath);
  const url = options.url ?? file.url;
  if (url === undefined || url.length === 0) {
    throw new CliError('BAD_DEFINITION', 'the definition carries no url; pass --url');
  }

  let config: ScrapeConfig;
  try {
    config = validateScrapeConfig(file.config);
  } catch (err) {
    throw new CliError('BAD_CONFIG', (err as Error).message);
  }
  config = applyTimeout(config, options.timeoutMs);

  const outDir = isAbsolute(options.outDir)
    ? options.outDir
    : resolve(process.cwd(), options.outDir);
  await mkdir(outDir, { recursive: true });

  const scrapeDeps: ScrapeDeps = {
    allowCdp: options.allowCdp === true,
    allowLocalProfile: options.allowLocalProfile === true,
  };
  const assertUrl = (target: string) =>
    assertSafeUrl(target, { allowPrivate: options.allowPrivateUrls === true });

  const browser = await deps.launchBrowser(options.headed === true);
  const files: RunLocalResult['files'] = [];
  try {
    const result = await runScrape(browser, url, config, { assertUrl }, scrapeDeps);
    for (const artifact of result.artifacts) {
      const name = artifactFilename(config, artifact.name);
      await writeFile(join(outDir, name), artifact.body);
      files.push({ name, type: artifact.type, bytes: artifact.body.length });
      log(`  ${artifact.type.padEnd(4)} ${name} (${artifact.body.length} bytes)`);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log(`wrote ${files.length} artifact(s) to ${outDir}`);
  return { url, outDir, files };
}

function errorCode(err: unknown): string {
  if (err instanceof CliError) return err.code;
  if (err instanceof StepError) return err.code;
  if (err instanceof Error && err.name.length > 0 && err.name !== 'Error') return err.name;
  return 'UNKNOWN';
}

export async function main(argv: string[], deps: RunLocalDeps): Promise<number> {
  let options: RunLocalOptions;
  try {
    const args = parseArgs(argv);
    if (args.switches.has('help')) {
      // eslint-disable-next-line no-console
      console.log(USAGE);
      return 0;
    }
    options = {
      definitionPath: requireFlag(args, 'definition'),
      outDir: requireFlag(args, 'out'),
      headed: args.switches.has('headed'),
      allowPrivateUrls: args.switches.has('allow-private'),
      allowCdp: args.switches.has('allow-cdp'),
      allowLocalProfile: args.switches.has('allow-profile'),
    };
    const url = args.flags.url;
    if (url !== undefined) options.url = url;
    const timeoutMs = integerFlag(args, 'timeout');
    if (timeoutMs !== undefined) options.timeoutMs = timeoutMs;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error BAD_ARGUMENTS: ${(err as Error).message}`);
    // eslint-disable-next-line no-console
    console.error(USAGE);
    return 2;
  }

  try {
    await runLocal(options, deps);
    return 0;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error ${errorCode(err)}: ${(err as Error).message}`);
    return 1;
  }
}

const isMain = process.argv[1]?.endsWith('run-local.js');
if (isMain) {
  const { chromium } = await import('playwright');
  const code = await main(process.argv.slice(2), {
    launchBrowser: (headed) => chromium.launch({ headless: !headed }),
  });
  process.exit(code);
}
