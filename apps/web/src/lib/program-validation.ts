import type { AuthConfig, Limits, ScrapeConfig, ScrapeFieldSelector, Step } from './types';
import { CAPTURE_TYPES, EMIT_TYPES, WAIT_UNTIL_VALUES } from './steps';

/**
 * A mirror of the v2 half of `validateScrapeConfig` in
 * `packages/shared/src/scrape-config.ts`. The web app does not import the
 * shared package, so it mirrors the rules the way `types.ts` mirrors the types.
 * The API stays the authority. This copy only keeps a bad program out of a save
 * and reports the same paths and the same messages in the browser.
 */

export type ProgramValidation =
  | { ok: true; config: ScrapeConfig }
  | { ok: false; error: string };

const LIMIT_KEYS: readonly (keyof Limits)[] = [
  'maxDurationMs',
  'maxSteps',
  'maxPages',
  'maxArtifacts',
];

class ProgramError extends Error {}

function fail(message: string): never {
  throw new ProgramError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function requireEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
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
  switch (input.op) {
    case 'goto': {
      const step: Step = { op: 'goto' };
      const url = optionalString(input.url, `${path}.url`);
      const waitUntil = optionalEnum(input.waitUntil, WAIT_UNTIL_VALUES, `${path}.waitUntil`);
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
      const state = optionalEnum(input.state, ['visible', 'attached'] as const, `${path}.state`);
      if (timeoutMs !== undefined) step.timeoutMs = timeoutMs;
      if (state !== undefined) step.state = state;
      return step;
    }
    case 'click': {
      const step: Step = {
        op: 'click',
        selector: requireString(input.selector, `${path}.selector`),
      };
      const opens = optionalEnum(input.opens, ['same', 'newTab'] as const, `${path}.opens`);
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
      return { op: 'fill', selector, valueFrom: requireString(input.valueFrom, `${path}.valueFrom`) };
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
        return { op: 'scroll', to, selector: requireString(input.selector, `${path}.selector`) };
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
            requireEnum(value, EMIT_TYPES, `${path}.emit[${index}]`),
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
          input.as.map((value, index) => requireEnum(value, CAPTURE_TYPES, `${path}.as[${index}]`)),
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
      return fail(`${path}.op is not a supported step: ${String(input.op)}`);
  }
}

function parseAuth(input: unknown, path: string): AuthConfig {
  if (!isRecord(input)) fail(`${path} must be an object`);
  const mode = requireEnum(
    input.mode,
    ['none', 'storageState', 'cdp', 'login'] as const,
    `${path}.mode`,
  );
  switch (mode) {
    case 'none':
      return { mode };
    case 'storageState':
      return { mode, secretRef: requireString(input.secretRef, `${path}.secretRef`) };
    case 'cdp':
      return { mode, endpointUrl: requireString(input.endpointUrl, `${path}.endpointUrl`) };
    case 'login': {
      const auth: AuthConfig = { mode, steps: parseNestedSteps(input.steps, `${path}.steps`) };
      const secretRef = optionalString(input.secretRef, `${path}.secretRef`);
      if (secretRef !== undefined) auth.secretRef = secretRef;
      return auth;
    }
  }
}

function parseLimits(input: unknown, path: string): Limits {
  if (!isRecord(input)) fail(`${path} must be an object`);
  const limits: Limits = {};
  for (const key of LIMIT_KEYS) {
    const value = optionalPositiveInt(input[key], `${path}.${key}`);
    if (value !== undefined) limits[key] = value;
  }
  return limits;
}

function parseConfig(input: unknown): ScrapeConfig {
  if (!isRecord(input)) fail('Scrape config must be an object');
  if (input.version !== 2) fail('version must be 2');
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    fail('steps must be a non-empty array');
  }

  const config: ScrapeConfig = {
    version: 2,
    steps: input.steps.map((step, index) => parseStep(step, `steps[${index}]`)),
  };
  if (input.auth !== undefined) config.auth = parseAuth(input.auth, 'auth');
  if (input.limits !== undefined) config.limits = parseLimits(input.limits, 'limits');
  const record = optionalBoolean(input.record, 'record');
  if (record !== undefined) config.record = record;
  if (input.upgradedFrom !== undefined) {
    if (input.upgradedFrom !== 1) fail('upgradedFrom must be 1 when provided');
    config.upgradedFrom = 1;
  }
  return config;
}

export function validateProgram(input: unknown): ProgramValidation {
  try {
    return { ok: true, config: parseConfig(input) };
  } catch (err) {
    if (err instanceof ProgramError) return { ok: false, error: err.message };
    throw err;
  }
}

export function parseProgramText(text: string): ProgramValidation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
  }
  return validateProgram(parsed);
}
