export type ArtifactType = 'JSON' | 'CSV' | 'PNG' | 'HTML' | 'WEBM' | 'PDF';
export type CaptureType = 'PNG' | 'PDF' | 'HTML';
export type WaitUntil = 'load' | 'domcontentloaded' | 'networkidle';

export const ARTIFACT_TYPES: readonly ArtifactType[] = [
  'JSON',
  'CSV',
  'PNG',
  'HTML',
  'WEBM',
  'PDF',
];

export const CAPTURE_TYPES: readonly CaptureType[] = ['PNG', 'PDF', 'HTML'];

const WAIT_UNTIL_VALUES: readonly WaitUntil[] = [
  'load',
  'domcontentloaded',
  'networkidle',
];

export interface ScrapeFieldSelector {
  name: string;
  selector: string;
  attribute?: string;
}

export interface Limits {
  maxDurationMs?: number;
  maxSteps?: number;
  maxPages?: number;
  maxArtifacts?: number;
}

export const DEFAULT_LIMITS: Required<Limits> = {
  maxDurationMs: 120_000,
  maxSteps: 500,
  maxPages: 50,
  maxArtifacts: 200,
};

export const LIMIT_CAPS: Required<Limits> = {
  maxDurationMs: 900_000,
  maxSteps: 10_000,
  maxPages: 500,
  maxArtifacts: 2_000,
};

export type AuthConfig =
  | { mode: 'none' }
  | { mode: 'storageState'; secretRef: string }
  | { mode: 'cdp'; endpointUrl: string }
  | { mode: 'chromeProfile'; userDataDir: string; profileDirectory?: string }
  | { mode: 'login'; secretRef?: string; steps: Step[] };

export const AUTH_MODES = [
  'none',
  'storageState',
  'cdp',
  'chromeProfile',
  'login',
] as const;

export type Step =
  | { op: 'goto'; url?: string; waitUntil?: WaitUntil }
  | {
      op: 'waitFor';
      selector: string;
      timeoutMs?: number;
      state?: 'visible' | 'attached';
    }
  | {
      op: 'click';
      selector: string;
      opens?: 'same' | 'newTab';
      timeoutMs?: number;
      optional?: boolean;
    }
  | { op: 'fill'; selector: string; value?: string; valueFrom?: string }
  | { op: 'select'; selector: string; value: string }
  | { op: 'press'; key: string }
  | { op: 'scroll'; to: 'bottom' | 'element'; selector?: string }
  | {
      op: 'extract';
      name: string;
      rowSelector?: string;
      fields: ScrapeFieldSelector[];
      emit?: ('JSON' | 'CSV')[];
    }
  | { op: 'capture'; as: CaptureType[]; name: string; fullPage?: boolean }
  | { op: 'forEach'; rowSelector: string; max?: number; steps: Step[] }
  | { op: 'openLink'; selector: string; attribute?: string; steps: Step[] }
  | { op: 'paginate'; nextSelector: string; maxPages: number; steps: Step[] }
  | { op: 'goBack' };

export interface ScrapeConfig {
  auth?: AuthConfig;
  steps: Step[];
  limits?: Limits;
  /** Record the whole browser context as WEBM. */
  record?: boolean;
}

export class ScrapeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScrapeConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  throw new ScrapeConfigError(message);
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    fail(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return requireString(value, path);
}

function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') fail(`${path} must be a boolean when provided`);
  return value;
}

function requirePositiveInt(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(`${path} must be a positive integer`);
  }
  return value;
}

function optionalPositiveInt(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return requirePositiveInt(value, path);
}

function requireEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    fail(`${path} must be one of ${allowed.join(', ')}`);
  }
  return value as T;
}

function optionalEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T | undefined {
  if (value === undefined) return undefined;
  return requireEnum(value, allowed, path);
}

function parseFields(value: unknown, path: string): ScrapeFieldSelector[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path} must be a non-empty array`);
  }
  return value.map((field, index) => {
    if (!isRecord(field)) fail(`${path}[${index}] must be an object`);
    const name = requireString(field.name, `${path}[${index}].name`);
    const selector = requireString(field.selector, `${path}[${index}].selector`);
    const attribute = optionalString(field.attribute, `${path}[${index}].attribute`);
    return attribute === undefined ? { name, selector } : { name, selector, attribute };
  });
}

function parseNestedSteps(value: unknown, path: string): Step[] {
  if (!Array.isArray(value) || value.length === 0) {
    fail(`${path} must be a non-empty array`);
  }
  return value.map((step, index) => parseStep(step, `${path}[${index}]`));
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function parseStep(input: unknown, path: string): Step {
  if (!isRecord(input)) fail(`${path} must be an object`);
  const op = input.op;
  switch (op) {
    case 'goto': {
      const url = optionalString(input.url, `${path}.url`);
      const waitUntil = optionalEnum(
        input.waitUntil,
        WAIT_UNTIL_VALUES,
        `${path}.waitUntil`,
      );
      const step: Step = { op: 'goto' };
      if (url !== undefined) step.url = url;
      if (waitUntil !== undefined) step.waitUntil = waitUntil;
      return step;
    }
    case 'waitFor': {
      const step: Step = {
        op: 'waitFor',
        selector: requireString(input.selector, `${path}.selector`),
      };
      const timeoutMs = optionalPositiveInt(input.timeoutMs, `${path}.timeoutMs`);
      const state = optionalEnum(
        input.state,
        ['visible', 'attached'] as const,
        `${path}.state`,
      );
      if (timeoutMs !== undefined) step.timeoutMs = timeoutMs;
      if (state !== undefined) step.state = state;
      return step;
    }
    case 'click': {
      const step: Step = {
        op: 'click',
        selector: requireString(input.selector, `${path}.selector`),
      };
      const opens = optionalEnum(
        input.opens,
        ['same', 'newTab'] as const,
        `${path}.opens`,
      );
      const timeoutMs = optionalPositiveInt(input.timeoutMs, `${path}.timeoutMs`);
      const optional = optionalBoolean(input.optional, `${path}.optional`);
      if (opens !== undefined) step.opens = opens;
      if (timeoutMs !== undefined) step.timeoutMs = timeoutMs;
      if (optional !== undefined) step.optional = optional;
      return step;
    }
    case 'fill': {
      const selector = requireString(input.selector, `${path}.selector`);
      const hasValue = input.value !== undefined;
      const hasValueFrom = input.valueFrom !== undefined;
      if (hasValue === hasValueFrom) {
        fail(`${path} must set exactly one of value and valueFrom`);
      }
      if (hasValue) {
        if (typeof input.value !== 'string') fail(`${path}.value must be a string`);
        return { op: 'fill', selector, value: input.value };
      }
      return {
        op: 'fill',
        selector,
        valueFrom: requireString(input.valueFrom, `${path}.valueFrom`),
      };
    }
    case 'select':
      return {
        op: 'select',
        selector: requireString(input.selector, `${path}.selector`),
        value: requireString(input.value, `${path}.value`),
      };
    case 'press':
      return { op: 'press', key: requireString(input.key, `${path}.key`) };
    case 'scroll': {
      const to = requireEnum(input.to, ['bottom', 'element'] as const, `${path}.to`);
      if (to === 'element') {
        return {
          op: 'scroll',
          to,
          selector: requireString(input.selector, `${path}.selector`),
        };
      }
      return { op: 'scroll', to };
    }
    case 'extract': {
      const step: Step = {
        op: 'extract',
        name: requireString(input.name, `${path}.name`),
        fields: parseFields(input.fields, `${path}.fields`),
      };
      const rowSelector = optionalString(input.rowSelector, `${path}.rowSelector`);
      if (rowSelector !== undefined) step.rowSelector = rowSelector;
      if (input.emit !== undefined) {
        if (!Array.isArray(input.emit) || input.emit.length === 0) {
          fail(`${path}.emit must be a non-empty array`);
        }
        step.emit = dedupe(
          input.emit.map((value, index) =>
            requireEnum(value, ['JSON', 'CSV'] as const, `${path}.emit[${index}]`),
          ),
        );
      }
      return step;
    }
    case 'capture': {
      if (!Array.isArray(input.as) || input.as.length === 0) {
        fail(`${path}.as must be a non-empty array`);
      }
      const step: Step = {
        op: 'capture',
        as: dedupe(
          input.as.map((value, index) =>
            requireEnum(value, CAPTURE_TYPES, `${path}.as[${index}]`),
          ),
        ),
        name: requireString(input.name, `${path}.name`),
      };
      const fullPage = optionalBoolean(input.fullPage, `${path}.fullPage`);
      if (fullPage !== undefined) step.fullPage = fullPage;
      return step;
    }
    case 'forEach': {
      const step: Step = {
        op: 'forEach',
        rowSelector: requireString(input.rowSelector, `${path}.rowSelector`),
        steps: parseNestedSteps(input.steps, `${path}.steps`),
      };
      const max = optionalPositiveInt(input.max, `${path}.max`);
      if (max !== undefined) step.max = max;
      return step;
    }
    case 'openLink': {
      const step: Step = {
        op: 'openLink',
        selector: requireString(input.selector, `${path}.selector`),
        steps: parseNestedSteps(input.steps, `${path}.steps`),
      };
      const attribute = optionalString(input.attribute, `${path}.attribute`);
      if (attribute !== undefined) step.attribute = attribute;
      return step;
    }
    case 'paginate':
      return {
        op: 'paginate',
        nextSelector: requireString(input.nextSelector, `${path}.nextSelector`),
        maxPages: requirePositiveInt(input.maxPages, `${path}.maxPages`),
        steps: parseNestedSteps(input.steps, `${path}.steps`),
      };
    case 'goBack':
      return { op: 'goBack' };
    default:
      return fail(`${path}.op is not a supported step: ${String(op)}`);
  }
}

function parseAuth(input: unknown, path: string): AuthConfig {
  if (!isRecord(input)) fail(`${path} must be an object`);
  const mode = requireEnum(input.mode, AUTH_MODES, `${path}.mode`);
  switch (mode) {
    case 'none':
      return { mode };
    case 'storageState':
      return { mode, secretRef: requireString(input.secretRef, `${path}.secretRef`) };
    case 'cdp':
      return {
        mode,
        endpointUrl: requireString(input.endpointUrl, `${path}.endpointUrl`),
      };
    case 'chromeProfile': {
      const auth: AuthConfig = {
        mode,
        userDataDir: requireString(input.userDataDir, `${path}.userDataDir`),
      };
      const profileDirectory = optionalString(
        input.profileDirectory,
        `${path}.profileDirectory`,
      );
      if (profileDirectory !== undefined) auth.profileDirectory = profileDirectory;
      return auth;
    }
    case 'login': {
      const auth: AuthConfig = {
        mode,
        steps: parseNestedSteps(input.steps, `${path}.steps`),
      };
      const secretRef = optionalString(input.secretRef, `${path}.secretRef`);
      if (secretRef !== undefined) auth.secretRef = secretRef;
      return auth;
    }
  }
}

function parseLimits(input: unknown, path: string): Limits {
  if (!isRecord(input)) fail(`${path} must be an object`);
  const limits: Limits = {};
  for (const key of Object.keys(LIMIT_CAPS) as (keyof Required<Limits>)[]) {
    const value = optionalPositiveInt(input[key], `${path}.${key}`);
    if (value !== undefined) limits[key] = Math.min(value, LIMIT_CAPS[key]);
  }
  return limits;
}

/**
 * Validate a scrape config. Rejects anything outside the closed step schema,
 * so a stored definition can never carry executable code.
 */
export function validateScrapeConfig(input: unknown): ScrapeConfig {
  if (!isRecord(input)) fail('Scrape config must be an object');
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    fail('steps must be a non-empty array');
  }

  const config: ScrapeConfig = {
    steps: input.steps.map((step, index) => parseStep(step, `steps[${index}]`)),
  };
  if (input.auth !== undefined) config.auth = parseAuth(input.auth, 'auth');
  if (input.limits !== undefined) config.limits = parseLimits(input.limits, 'limits');
  const record = optionalBoolean(input.record, 'record');
  if (record !== undefined) config.record = record;
  return config;
}

/** Fill every missing limit from `DEFAULT_LIMITS`. */
export function resolveLimits(limits: Limits | undefined): Required<Limits> {
  return { ...DEFAULT_LIMITS, ...limits };
}

function collectStepSecretRefs(steps: Step[], found: Set<string>): void {
  for (const step of steps) {
    if (step.op === 'fill' && step.valueFrom !== undefined) found.add(step.valueFrom);
    if (step.op === 'forEach' || step.op === 'openLink' || step.op === 'paginate') {
      collectStepSecretRefs(step.steps, found);
    }
  }
}

/**
 * Every secret name that a config needs, from `auth` and from every nested
 * `fill.valueFrom`. The worker resolves this list once before a run.
 */
export function collectSecretRefs(config: ScrapeConfig): string[] {
  const found = new Set<string>();
  const auth = config.auth;
  if (auth) {
    if (auth.mode === 'storageState') found.add(auth.secretRef);
    if (auth.mode === 'login') {
      if (auth.secretRef !== undefined) found.add(auth.secretRef);
      collectStepSecretRefs(auth.steps, found);
    }
  }
  collectStepSecretRefs(config.steps, found);
  return [...found];
}
