import { createWriteStream } from 'node:fs';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs, requireFlag } from './args.js';
import { unpackZip } from './unzip.js';

const USAGE = `usage: npm run export -- --run <run-id> --out <folder> [--api http://localhost:4000]

Download every artifact of one run and write it into the folder. It reads the
streaming archive at GET /runs/<run-id>/artifacts.zip.`;

const DEFAULT_API_BASE_URL = 'http://localhost:4000';

export interface ExportOptions {
  runId: string;
  outDir: string;
  apiBaseUrl?: string;
}

export interface ExportDeps {
  fetch?: typeof globalThis.fetch;
  log?: (line: string) => void;
}

export interface ExportResult {
  outDir: string;
  files: string[];
}

export class ExportError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'ExportError';
  }
}

async function errorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body.error ?? `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

export async function exportRun(
  options: ExportOptions,
  deps: ExportDeps = {},
): Promise<ExportResult> {
  const log = deps.log ?? ((line: string) => console.log(line)); // eslint-disable-line no-console
  const doFetch = deps.fetch ?? globalThis.fetch;
  const base = (options.apiBaseUrl ?? process.env.API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(
    /\/$/,
    '',
  );
  const outDir = isAbsolute(options.outDir)
    ? options.outDir
    : resolve(process.cwd(), options.outDir);

  const url = `${base}/runs/${encodeURIComponent(options.runId)}/artifacts.zip`;
  const res = await doFetch(url);
  if (!res.ok) {
    throw new ExportError('EXPORT_FAILED', `${url}: ${await errorText(res)}`);
  }
  if (!res.body) {
    throw new ExportError('EXPORT_FAILED', `${url}: the response carried no body`);
  }

  await mkdir(outDir, { recursive: true });
  // yauzl reads the central directory from the end of the file, so the archive
  // lands on disk first. Memory stays flat however large the run is.
  const zipPath = join(tmpdir(), `scraper-export-${options.runId}-${Date.now()}.zip`);
  try {
    await pipeline(Readable.fromWeb(res.body as never), createWriteStream(zipPath));
    const files = await unpackZip(zipPath, outDir);
    for (const name of files) {
      const { size } = await stat(join(outDir, name));
      log(`  ${name} (${size} bytes)`);
    }
    log(`wrote ${files.length} artifact(s) to ${outDir}`);
    return { outDir, files };
  } finally {
    await rm(zipPath, { force: true }).catch(() => {});
  }
}

export async function main(argv: string[], deps: ExportDeps = {}): Promise<number> {
  let options: ExportOptions;
  try {
    const args = parseArgs(argv);
    if (args.switches.has('help')) {
      // eslint-disable-next-line no-console
      console.log(USAGE);
      return 0;
    }
    options = { runId: requireFlag(args, 'run'), outDir: requireFlag(args, 'out') };
    const api = args.flags.api;
    if (api !== undefined) options.apiBaseUrl = api;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`error BAD_ARGUMENTS: ${(err as Error).message}`);
    // eslint-disable-next-line no-console
    console.error(USAGE);
    return 2;
  }

  try {
    await exportRun(options, deps);
    return 0;
  } catch (err) {
    const code = err instanceof ExportError ? err.code : 'UNKNOWN';
    // eslint-disable-next-line no-console
    console.error(`error ${code}: ${(err as Error).message}`);
    return 1;
  }
}

const isMain = process.argv[1]?.endsWith('export.js');
if (isMain) {
  process.exit(await main(process.argv.slice(2)));
}
