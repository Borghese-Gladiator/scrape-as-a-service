import type { AuthConfig, CaptureType, ScrapeConfig, Step, WaitUntil } from './types';

export type StepOp = Step['op'];
export type AuthMode = AuthConfig['mode'];

export const STEP_OPS: readonly StepOp[] = [
  'goto',
  'waitFor',
  'click',
  'fill',
  'select',
  'press',
  'scroll',
  'extract',
  'capture',
  'forEach',
  'openLink',
  'paginate',
  'goBack',
];

export const NESTING_OPS: readonly StepOp[] = ['forEach', 'openLink', 'paginate'];

export const AUTH_MODES: readonly AuthMode[] = [
  'none',
  'storageState',
  'cdp',
  'chromeProfile',
  'login',
];

export const WAIT_UNTIL_VALUES: readonly WaitUntil[] = ['load', 'domcontentloaded', 'networkidle'];

export const CAPTURE_TYPES: readonly CaptureType[] = ['PNG', 'PDF', 'HTML'];

export const EMIT_TYPES: readonly ('JSON' | 'CSV')[] = ['JSON', 'CSV'];

/** The deepest step list that the form editor renders. The JSON editor has no cap. */
export const MAX_NESTING_DEPTH = 3;

export const STEP_OP_SUMMARY: Record<StepOp, string> = {
  goto: 'Navigate to a URL',
  waitFor: 'Wait for a selector',
  click: 'Click an element',
  fill: 'Type into an input',
  select: 'Choose a select option',
  press: 'Press a key',
  scroll: 'Scroll the page',
  extract: 'Read fields into a dataset',
  capture: 'Capture the page',
  forEach: 'Repeat steps for each row',
  openLink: 'Follow a link, then run steps',
  paginate: 'Repeat steps on each page',
  goBack: 'Go back one page',
};

export function isNestingOp(op: StepOp): boolean {
  return NESTING_OPS.includes(op);
}

export function createStep(op: StepOp): Step {
  switch (op) {
    case 'goto':
      return { op: 'goto' };
    case 'waitFor':
      return { op: 'waitFor', selector: '' };
    case 'click':
      return { op: 'click', selector: '' };
    case 'fill':
      return { op: 'fill', selector: '', value: '' };
    case 'select':
      return { op: 'select', selector: '', value: '' };
    case 'press':
      return { op: 'press', key: '' };
    case 'scroll':
      return { op: 'scroll', to: 'bottom' };
    case 'extract':
      return { op: 'extract', name: '', fields: [{ name: '', selector: '' }] };
    case 'capture':
      return { op: 'capture', as: ['PNG'], name: '' };
    case 'forEach':
      return { op: 'forEach', rowSelector: '', steps: [] };
    case 'openLink':
      return { op: 'openLink', selector: '', steps: [] };
    case 'paginate':
      return { op: 'paginate', nextSelector: '', maxPages: 5, steps: [] };
    case 'goBack':
      return { op: 'goBack' };
  }
}

export function createProgram(): ScrapeConfig {
  return { auth: { mode: 'none' }, steps: [createStep('goto')] };
}

export function createAuth(mode: AuthMode): AuthConfig {
  switch (mode) {
    case 'none':
      return { mode: 'none' };
    case 'storageState':
      return { mode: 'storageState', secretRef: '' };
    case 'cdp':
      return { mode: 'cdp', endpointUrl: '' };
    case 'chromeProfile':
      return { mode: 'chromeProfile', userDataDir: '' };
    case 'login':
      return { mode: 'login', steps: [] };
  }
}

export function childStepsOf(step: Step): Step[] | null {
  switch (step.op) {
    case 'forEach':
    case 'openLink':
    case 'paginate':
      return step.steps;
    default:
      return null;
  }
}

export function withChildSteps(step: Step, steps: Step[]): Step {
  switch (step.op) {
    case 'forEach':
      return { ...step, steps };
    case 'openLink':
      return { ...step, steps };
    case 'paginate':
      return { ...step, steps };
    default:
      return step;
  }
}

/** Swap a step for another verb. Nested steps survive a swap between two nesting verbs. */
export function changeStepOp(step: Step, op: StepOp): Step {
  const next = createStep(op);
  const children = childStepsOf(step);
  if (children === null || children.length === 0) return next;
  if (childStepsOf(next) === null) return next;
  return withChildSteps(next, children);
}

/** Apply `fn` to the step list that `path` addresses. `path` is a parent path. */
function transformList(steps: Step[], path: number[], fn: (list: Step[]) => Step[]): Step[] {
  const head = path[0];
  if (head === undefined) return fn(steps);
  const rest = path.slice(1);
  return steps.map((step, index) => {
    if (index !== head) return step;
    const children = childStepsOf(step);
    if (children === null) return step;
    return withChildSteps(step, transformList(children, rest, fn));
  });
}

export function insertStep(steps: Step[], parentPath: number[], step: Step): Step[] {
  return transformList(steps, parentPath, (list) => [...list, step]);
}

export function removeStep(steps: Step[], path: number[]): Step[] {
  const index = path[path.length - 1] ?? -1;
  return transformList(steps, path.slice(0, -1), (list) => list.filter((_, i) => i !== index));
}

export function moveStep(steps: Step[], path: number[], delta: -1 | 1): Step[] {
  const index = path[path.length - 1] ?? -1;
  return transformList(steps, path.slice(0, -1), (list) => {
    const target = index + delta;
    const moved = list[index];
    const displaced = list[target];
    if (moved === undefined || displaced === undefined) return list;
    const next = [...list];
    next[index] = displaced;
    next[target] = moved;
    return next;
  });
}

export function updateStep(steps: Step[], path: number[], next: Step): Step[] {
  const index = path[path.length - 1] ?? -1;
  return transformList(steps, path.slice(0, -1), (list) =>
    list.map((step, i) => (i === index ? next : step)),
  );
}

export function stepAt(steps: Step[], path: number[]): Step | null {
  let list: Step[] | null = steps;
  let found: Step | null = null;
  for (const index of path) {
    if (list === null) return null;
    found = list[index] ?? null;
    if (found === null) return null;
    list = childStepsOf(found);
  }
  return found;
}

/** Render a step path as `1.2.1`, so every control has a unique accessible name. */
export function stepLabel(path: number[]): string {
  return path.map((index) => index + 1).join('.');
}

/** Set `key`, or delete it when the user clears the input. An absent key is a valid step. */
export function withOptional<T extends object>(step: T, key: string, value: unknown): T {
  const next = { ...step } as Record<string, unknown>;
  if (value === undefined || value === '') delete next[key];
  else next[key] = value;
  return next as T;
}
