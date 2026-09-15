'use client';

import type { Step } from '@/lib/types';
import {
  MAX_NESTING_DEPTH,
  STEP_OPS,
  STEP_OP_SUMMARY,
  changeStepOp,
  childStepsOf,
  createStep,
  insertStep,
  moveStep,
  removeStep,
  stepLabel,
  updateStep,
  type StepOp,
} from '@/lib/steps';
import { StepFields } from './StepFields';

export interface StepActions {
  add: (parentPath: number[], op: StepOp) => void;
  remove: (path: number[]) => void;
  move: (path: number[], delta: -1 | 1) => void;
  update: (path: number[], step: Step) => void;
}

interface TreeIdentity {
  /** Prefixes every element id, so two trees on one page never collide. */
  idScope: string;
  /** Prefixes every accessible name, for example `Step 5.1` or `Login step 2`. */
  namePrefix: string;
}

function StepEditor({
  step,
  path,
  depth,
  siblingCount,
  identity,
  actions,
}: {
  step: Step;
  path: number[];
  depth: number;
  siblingCount: number;
  identity: TreeIdentity;
  actions: StepActions;
}) {
  const label = `${identity.namePrefix} ${stepLabel(path)}`;
  const lowerLabel = label.toLowerCase();
  const idPrefix = `${identity.idScope}-${path.join('-')}`;
  const index = path[path.length - 1] ?? 0;
  const children = childStepsOf(step);

  return (
    <fieldset className="step">
      <legend>{label}</legend>

      <div className="step-toolbar">
        <select
          aria-label={`${label} verb`}
          value={step.op}
          onChange={(e) => actions.update(path, changeStepOp(step, e.target.value as StepOp))}
        >
          {STEP_OPS.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary"
          aria-label={`Move ${lowerLabel} up`}
          disabled={index === 0}
          onClick={() => actions.move(path, -1)}
        >
          Up
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={`Move ${lowerLabel} down`}
          disabled={index === siblingCount - 1}
          onClick={() => actions.move(path, 1)}
        >
          Down
        </button>
        <button
          type="button"
          className="secondary"
          aria-label={`Remove ${lowerLabel}`}
          onClick={() => actions.remove(path)}
        >
          Remove
        </button>
      </div>

      <p className="muted">{STEP_OP_SUMMARY[step.op]}</p>

      <StepFields step={step} idPrefix={idPrefix} onChange={(next) => actions.update(path, next)} />

      {children === null ? null : depth < MAX_NESTING_DEPTH ? (
        <div className="step-children">
          <StepList
            steps={children}
            basePath={path}
            depth={depth + 1}
            addLabel={`Add step to ${lowerLabel}`}
            identity={identity}
            actions={actions}
          />
        </div>
      ) : (
        <p className="muted">
          Nesting stops at {MAX_NESTING_DEPTH} levels. This step holds {children.length} nested
          steps. Use the JSON editor to change them.
        </p>
      )}
    </fieldset>
  );
}

function StepList({
  steps,
  basePath,
  depth,
  addLabel,
  identity,
  actions,
}: {
  steps: Step[];
  basePath: number[];
  depth: number;
  addLabel: string;
  identity: TreeIdentity;
  actions: StepActions;
}) {
  return (
    <div className="step-list">
      {steps.length === 0 ? <p className="muted">No steps yet.</p> : null}
      {steps.map((step, index) => (
        <StepEditor
          key={index}
          step={step}
          path={[...basePath, index]}
          depth={depth}
          siblingCount={steps.length}
          identity={identity}
          actions={actions}
        />
      ))}
      <button
        type="button"
        className="secondary"
        aria-label={addLabel}
        onClick={() => actions.add(basePath, 'goto')}
      >
        {addLabel}
      </button>
    </div>
  );
}

/** A whole step tree, with the add, remove, move, and update wiring. */
export function StepTree({
  steps,
  onChange,
  idScope,
  namePrefix,
  addLabel,
}: {
  steps: Step[];
  onChange: (steps: Step[]) => void;
  idScope: string;
  namePrefix: string;
  addLabel: string;
}) {
  const actions: StepActions = {
    add: (parentPath, op) => onChange(insertStep(steps, parentPath, createStep(op))),
    remove: (path) => onChange(removeStep(steps, path)),
    move: (path, delta) => onChange(moveStep(steps, path, delta)),
    update: (path, step) => onChange(updateStep(steps, path, step)),
  };

  return (
    <StepList
      steps={steps}
      basePath={[]}
      depth={1}
      addLabel={addLabel}
      identity={{ idScope, namePrefix }}
      actions={actions}
    />
  );
}
