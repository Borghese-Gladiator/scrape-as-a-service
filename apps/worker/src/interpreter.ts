import type { BrowserContext, Locator, Page } from 'playwright';
import type {
  ArtifactType,
  CaptureType,
  Limits,
  ScrapeConfig,
  ScrapeFieldSelector,
  Step,
} from '@scraper/shared';
import { resolveLimits } from '@scraper/shared';
import { toCsv } from './artifacts.js';
import {
  resolveNameTemplate,
  sanitizeArtifactName,
  uniqueArtifactName,
  type NameBindings,
} from './names.js';

export interface CapturedArtifact {
  type: ArtifactType;
  name: string;
  body: Buffer;
  contentType: string;
  stepIndex: number;
}

export interface ScrapeResult {
  datasets: Record<string, Record<string, string | null>[]>;
  artifacts: CapturedArtifact[];
}

export interface RunScrapeOptions {
  secrets?: Record<string, string>;
  now?: () => number;
}

export class StepError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = code;
  }
}

const DEFAULT_WAIT_TIMEOUT_MS = 15_000;
const SETTLE_TIMEOUT_MS = 5_000;

/**
 * A constant this repository owns. The mission forbids the evaluation of
 * user-supplied JavaScript; there is no selector-only way to scroll a window.
 */
const SCROLL_TO_BOTTOM = 'window.scrollTo(0, document.body.scrollHeight)';

const CAPTURE_META: Record<
  CaptureType,
  { type: ArtifactType; extension: string; contentType: string }
> = {
  PNG: { type: 'PNG', extension: '.png', contentType: 'image/png' },
  PDF: { type: 'PDF', extension: '.pdf', contentType: 'application/pdf' },
  HTML: { type: 'HTML', extension: '.html', contentType: 'text/html' },
};

interface DatasetMeta {
  emitCsv: boolean;
  stepIndex: number;
}

interface Frame {
  scope: Locator | null;
  bindings: NameBindings;
}

interface ExecState {
  context: BrowserContext;
  defaultUrl: string;
  limits: Required<Limits>;
  now: () => number;
  startedAt: number;
  secrets: Record<string, string>;
  pages: Page[];
  datasets: Record<string, Record<string, string | null>[]>;
  datasetMeta: Map<string, DatasetMeta>;
  artifacts: CapturedArtifact[];
  usedNames: Map<string, number>;
  stepCount: number;
  pageCount: number;
  forEachOffsets: Map<Step, number>;
}

function limitExceeded(limit: keyof Required<Limits>, value: number): StepError {
  return new StepError('LIMIT_EXCEEDED', `${limit} exceeded: ${value}`);
}

function currentPage(state: ExecState): Page {
  const page = state.pages[state.pages.length - 1];
  if (!page) throw new StepError('UNKNOWN', 'no page is open');
  return page;
}

function resolve(state: ExecState, frame: Frame, selector: string): Locator {
  return frame.scope ? frame.scope.locator(selector) : currentPage(state).locator(selector);
}

function countPage(state: ExecState): void {
  state.pageCount += 1;
  if (state.pageCount > state.limits.maxPages) {
    throw limitExceeded('maxPages', state.limits.maxPages);
  }
}

function pushArtifact(state: ExecState, artifact: CapturedArtifact): void {
  if (state.artifacts.length >= state.limits.maxArtifacts) {
    throw limitExceeded('maxArtifacts', state.limits.maxArtifacts);
  }
  state.artifacts.push(artifact);
}

async function readFields(
  scope: Locator,
  fields: ScrapeFieldSelector[],
): Promise<Record<string, string | null>> {
  const row: Record<string, string | null> = {};
  for (const field of fields) {
    const element = scope.locator(field.selector).first();
    if ((await element.count()) === 0) {
      row[field.name] = null;
      continue;
    }
    row[field.name] = field.attribute
      ? await element.getAttribute(field.attribute)
      : ((await element.textContent())?.trim() ?? null);
  }
  return row;
}

async function isDisabled(locator: Locator): Promise<boolean> {
  const [disabled, ariaDisabled, className] = await Promise.all([
    locator.getAttribute('disabled'),
    locator.getAttribute('aria-disabled'),
    locator.getAttribute('class'),
  ]);
  if (disabled !== null) return true;
  if (ariaDisabled === 'true') return true;
  return (className ?? '').includes('disabled');
}

function signatureSelector(steps: Step[]): string | null {
  for (const step of steps) {
    if (step.op === 'forEach') return step.rowSelector;
    if (step.op === 'extract' && step.rowSelector !== undefined) return step.rowSelector;
  }
  return null;
}

async function pageSignature(
  state: ExecState,
  frame: Frame,
  rowSelector: string | null,
): Promise<string> {
  const url = currentPage(state).url();
  if (rowSelector === null) return url;
  const rows = resolve(state, frame, rowSelector);
  const count = await rows.count();
  const first = count === 0 ? '' : ((await rows.first().textContent()) ?? '');
  return `${url}|${count}|${first.trim().slice(0, 200)}`;
}

async function runGoto(state: ExecState, step: Extract<Step, { op: 'goto' }>): Promise<void> {
  countPage(state);
  await currentPage(state).goto(step.url ?? state.defaultUrl, {
    waitUntil: step.waitUntil ?? 'load',
  });
}

async function runWaitFor(
  state: ExecState,
  step: Extract<Step, { op: 'waitFor' }>,
  frame: Frame,
): Promise<void> {
  const options = {
    state: step.state ?? ('visible' as const),
    timeout: step.timeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS,
  };
  if (frame.scope) {
    await frame.scope.locator(step.selector).first().waitFor(options);
    return;
  }
  await currentPage(state).waitForSelector(step.selector, options);
}

async function runClick(
  state: ExecState,
  step: Extract<Step, { op: 'click' }>,
  frame: Frame,
): Promise<void> {
  const target = resolve(state, frame, step.selector).first();
  if (step.optional === true && (await target.count()) === 0) return;

  const options = step.timeoutMs === undefined ? {} : { timeout: step.timeoutMs };
  if (step.opens !== 'newTab') {
    await target.click(options);
    return;
  }

  const [opened] = await Promise.all([
    state.context.waitForEvent('page'),
    target.click(options),
  ]);
  countPage(state);
  await opened.waitForLoadState('load').catch(() => {});
  state.pages.push(opened);
}

async function runFill(
  state: ExecState,
  step: Extract<Step, { op: 'fill' }>,
  frame: Frame,
): Promise<void> {
  let value = step.value;
  if (value === undefined) {
    if (step.valueFrom === undefined) {
      throw new StepError('UNKNOWN', 'fill requires value or valueFrom');
    }
    const secret = state.secrets[step.valueFrom];
    if (secret === undefined) {
      throw new StepError('AUTH_FAILED', `secret is not available: ${step.valueFrom}`);
    }
    value = secret;
  }
  await resolve(state, frame, step.selector).first().fill(value);
}

async function runScroll(
  state: ExecState,
  step: Extract<Step, { op: 'scroll' }>,
  frame: Frame,
): Promise<void> {
  if (step.to === 'element') {
    if (step.selector === undefined) {
      throw new StepError('UNKNOWN', 'scroll to element requires a selector');
    }
    await resolve(state, frame, step.selector).first().scrollIntoViewIfNeeded();
    return;
  }
  await currentPage(state).evaluate(SCROLL_TO_BOTTOM);
}

async function runExtract(
  state: ExecState,
  step: Extract<Step, { op: 'extract' }>,
  frame: Frame,
  stepIndex: number,
): Promise<void> {
  const rows: Record<string, string | null>[] = [];
  if (step.rowSelector !== undefined) {
    const locator = resolve(state, frame, step.rowSelector);
    const count = await locator.count();
    for (let i = 0; i < count; i += 1) {
      rows.push(await readFields(locator.nth(i), step.fields));
    }
  } else {
    rows.push(await readFields(frame.scope ?? currentPage(state).locator('body'), step.fields));
  }

  state.datasets[step.name] = (state.datasets[step.name] ?? []).concat(rows);

  const emitCsv = (step.emit ?? ['JSON']).includes('CSV');
  const meta = state.datasetMeta.get(step.name);
  if (meta) {
    meta.emitCsv = meta.emitCsv || emitCsv;
  } else {
    state.datasetMeta.set(step.name, { emitCsv, stepIndex });
  }

  const last = rows[rows.length - 1];
  if (last) frame.bindings.row = last;
}

async function runCapture(
  state: ExecState,
  step: Extract<Step, { op: 'capture' }>,
  frame: Frame,
  stepIndex: number,
): Promise<void> {
  const page = currentPage(state);
  const base = sanitizeArtifactName(resolveNameTemplate(step.name, frame.bindings));

  for (const captureType of step.as) {
    const meta = CAPTURE_META[captureType];
    let body: Buffer;
    if (captureType === 'PNG') {
      body = await page.screenshot({ fullPage: step.fullPage ?? true });
    } else if (captureType === 'PDF') {
      body = await page.pdf();
    } else {
      body = Buffer.from(await page.content(), 'utf8');
    }
    pushArtifact(state, {
      type: meta.type,
      name: uniqueArtifactName(base, meta.extension, state.usedNames),
      body,
      contentType: meta.contentType,
      stepIndex,
    });
  }
}

async function runForEach(
  state: ExecState,
  step: Extract<Step, { op: 'forEach' }>,
  frame: Frame,
): Promise<void> {
  const total = await resolve(state, frame, step.rowSelector).count();
  const count = step.max === undefined ? total : Math.min(total, step.max);
  const offset = state.forEachOffsets.get(step) ?? 0;

  for (let i = 0; i < count; i += 1) {
    // Re-resolve the row on every pass: a nested step may have changed the DOM.
    const row = resolve(state, frame, step.rowSelector).nth(i);
    await runSteps(state, step.steps, {
      scope: row,
      bindings: { ...frame.bindings, index: offset + i },
    });
  }
  state.forEachOffsets.set(step, offset + count);
}

async function runOpenLink(
  state: ExecState,
  step: Extract<Step, { op: 'openLink' }>,
  frame: Frame,
): Promise<void> {
  const attribute = step.attribute ?? 'href';
  const raw = await resolve(state, frame, step.selector).first().getAttribute(attribute);
  if (raw === null || raw.length === 0) {
    throw new StepError(
      'SELECTOR_NOT_FOUND',
      `openLink found no ${attribute} on ${step.selector}`,
    );
  }
  const target = new URL(raw, currentPage(state).url()).toString();

  countPage(state);
  const page = await state.context.newPage();
  state.pages.push(page);
  try {
    await page.goto(target, { waitUntil: 'load' });
    await runSteps(state, step.steps, { scope: null, bindings: { ...frame.bindings } });
  } finally {
    state.pages.pop();
    await page.close().catch(() => {});
  }
}

async function runPaginate(
  state: ExecState,
  step: Extract<Step, { op: 'paginate' }>,
  frame: Frame,
): Promise<void> {
  const rowSelector = signatureSelector(step.steps);
  let pageNumber = 1;

  for (;;) {
    await runSteps(state, step.steps, {
      scope: frame.scope,
      bindings: { ...frame.bindings, page: pageNumber },
    });
    if (pageNumber >= step.maxPages) return;

    const next = resolve(state, frame, step.nextSelector).first();
    if ((await next.count()) === 0) return;
    if (await isDisabled(next)) return;

    const before = await pageSignature(state, frame, rowSelector);
    await next.click();
    await currentPage(state)
      .waitForLoadState('networkidle', { timeout: SETTLE_TIMEOUT_MS })
      .catch(() => {});
    const after = await pageSignature(state, frame, rowSelector);
    if (after === before) return;

    pageNumber += 1;
  }
}

async function runGoBack(state: ExecState): Promise<void> {
  if (state.pages.length > 1) {
    const page = state.pages.pop();
    if (page) await page.close().catch(() => {});
    return;
  }
  await currentPage(state).goBack();
}

async function runStep(state: ExecState, step: Step, frame: Frame): Promise<void> {
  if (state.now() - state.startedAt > state.limits.maxDurationMs) {
    throw limitExceeded('maxDurationMs', state.limits.maxDurationMs);
  }
  if (state.stepCount >= state.limits.maxSteps) {
    throw limitExceeded('maxSteps', state.limits.maxSteps);
  }
  const stepIndex = state.stepCount;
  state.stepCount += 1;

  switch (step.op) {
    case 'goto':
      return runGoto(state, step);
    case 'waitFor':
      return runWaitFor(state, step, frame);
    case 'click':
      return runClick(state, step, frame);
    case 'fill':
      return runFill(state, step, frame);
    case 'select':
      await resolve(state, frame, step.selector).first().selectOption(step.value);
      return;
    case 'press':
      await currentPage(state).keyboard.press(step.key);
      return;
    case 'scroll':
      return runScroll(state, step, frame);
    case 'extract':
      return runExtract(state, step, frame, stepIndex);
    case 'capture':
      return runCapture(state, step, frame, stepIndex);
    case 'forEach':
      return runForEach(state, step, frame);
    case 'openLink':
      return runOpenLink(state, step, frame);
    case 'paginate':
      return runPaginate(state, step, frame);
    case 'goBack':
      return runGoBack(state);
  }
}

async function runSteps(state: ExecState, steps: Step[], frame: Frame): Promise<void> {
  for (const step of steps) {
    await runStep(state, step, frame);
  }
}

/**
 * One JSON artifact per dataset, written once at the end of the program. An
 * `extract` inside a loop appends to its dataset, so a paginated table becomes
 * a single file that holds every row.
 */
function emitDatasetArtifacts(state: ExecState): void {
  for (const [name, meta] of state.datasetMeta) {
    const rows = state.datasets[name] ?? [];
    const base = sanitizeArtifactName(name);
    pushArtifact(state, {
      type: 'JSON',
      name: uniqueArtifactName(base, '.json', state.usedNames),
      body: Buffer.from(JSON.stringify(rows, null, 2), 'utf8'),
      contentType: 'application/json',
      stepIndex: meta.stepIndex,
    });
    if (meta.emitCsv) {
      pushArtifact(state, {
        type: 'CSV',
        name: uniqueArtifactName(base, '.csv', state.usedNames),
        body: toCsv(rows),
        contentType: 'text/csv',
        stepIndex: meta.stepIndex,
      });
    }
  }
}

/**
 * Execute a step program. The program is data: every verb comes from a closed
 * schema that `validateScrapeConfig` checked before storage, so no
 * user-supplied JavaScript ever reaches the page.
 */
export async function runProgram(
  context: BrowserContext,
  url: string,
  config: ScrapeConfig,
  options: RunScrapeOptions = {},
): Promise<ScrapeResult> {
  const now = options.now ?? Date.now;
  const state: ExecState = {
    context,
    defaultUrl: url,
    limits: resolveLimits(config.limits),
    now,
    startedAt: now(),
    secrets: options.secrets ?? {},
    pages: [],
    datasets: {},
    datasetMeta: new Map(),
    artifacts: [],
    usedNames: new Map(),
    stepCount: 0,
    pageCount: 0,
    forEachOffsets: new Map(),
  };

  state.pages.push(await context.newPage());
  await runSteps(state, config.steps, { scope: null, bindings: {} });
  emitDatasetArtifacts(state);

  return { datasets: state.datasets, artifacts: state.artifacts };
}
