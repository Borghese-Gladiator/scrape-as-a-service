'use client';

import type { ScrapeFieldSelector, Step } from '@/lib/types';
import {
  CAPTURE_TYPES,
  EMIT_TYPES,
  WAIT_UNTIL_VALUES,
  withOptional,
  type StepOp,
} from '@/lib/steps';

type StepOfOp<O extends StepOp> = Extract<Step, { op: O }>;

interface FieldsProps<O extends StepOp> {
  step: StepOfOp<O>;
  idPrefix: string;
  onChange: (step: Step) => void;
}

function numberOrUndefined(value: string): number | undefined {
  if (value.trim().length === 0) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function GotoFields({ step, idPrefix, onChange }: FieldsProps<'goto'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-url`}>Navigate to URL</label>
        <input
          id={`${idPrefix}-url`}
          value={step.url ?? ''}
          onChange={(e) => onChange(withOptional(step, 'url', e.target.value))}
          placeholder="Empty uses the definition URL"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-waituntil`}>Wait until</label>
        <select
          id={`${idPrefix}-waituntil`}
          value={step.waitUntil ?? ''}
          onChange={(e) => onChange(withOptional(step, 'waitUntil', e.target.value))}
        >
          <option value="">Default</option>
          {WAIT_UNTIL_VALUES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

function WaitForFields({ step, idPrefix, onChange }: FieldsProps<'waitFor'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-selector`}>Selector</label>
        <input
          id={`${idPrefix}-selector`}
          value={step.selector}
          onChange={(e) => onChange({ ...step, selector: e.target.value })}
          placeholder=".content-loaded"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-timeout`}>Timeout (ms)</label>
        <input
          id={`${idPrefix}-timeout`}
          value={step.timeoutMs ?? ''}
          onChange={(e) => onChange(withOptional(step, 'timeoutMs', numberOrUndefined(e.target.value)))}
          placeholder="30000"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-state`}>State</label>
        <select
          id={`${idPrefix}-state`}
          value={step.state ?? ''}
          onChange={(e) => onChange(withOptional(step, 'state', e.target.value))}
        >
          <option value="">Default</option>
          <option value="visible">visible</option>
          <option value="attached">attached</option>
        </select>
      </div>
    </>
  );
}

function ClickFields({ step, idPrefix, onChange }: FieldsProps<'click'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-selector`}>Selector</label>
        <input
          id={`${idPrefix}-selector`}
          value={step.selector}
          onChange={(e) => onChange({ ...step, selector: e.target.value })}
          placeholder="button.submit"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-opens`}>Opens</label>
        <select
          id={`${idPrefix}-opens`}
          value={step.opens ?? ''}
          onChange={(e) => onChange(withOptional(step, 'opens', e.target.value))}
        >
          <option value="">Default</option>
          <option value="same">same</option>
          <option value="newTab">newTab</option>
        </select>
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-timeout`}>Timeout (ms)</label>
        <input
          id={`${idPrefix}-timeout`}
          value={step.timeoutMs ?? ''}
          onChange={(e) => onChange(withOptional(step, 'timeoutMs', numberOrUndefined(e.target.value)))}
          placeholder="30000"
        />
      </div>
      <div className="checkbox-row">
        <input
          id={`${idPrefix}-optional`}
          type="checkbox"
          checked={step.optional ?? false}
          onChange={(e) => onChange(withOptional(step, 'optional', e.target.checked || undefined))}
        />
        <label htmlFor={`${idPrefix}-optional`} style={{ margin: 0 }}>
          Optional
        </label>
      </div>
    </>
  );
}

function FillFields({ step, idPrefix, onChange }: FieldsProps<'fill'>) {
  const source = step.valueFrom !== undefined ? 'valueFrom' : 'value';

  function changeSource(next: string) {
    if (next === 'valueFrom') onChange({ op: 'fill', selector: step.selector, valueFrom: '' });
    else onChange({ op: 'fill', selector: step.selector, value: '' });
  }

  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-selector`}>Selector</label>
        <input
          id={`${idPrefix}-selector`}
          value={step.selector}
          onChange={(e) => onChange({ ...step, selector: e.target.value })}
          placeholder="#StartDate"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-source`}>Value source</label>
        <select
          id={`${idPrefix}-source`}
          value={source}
          onChange={(e) => changeSource(e.target.value)}
        >
          <option value="value">Literal value</option>
          <option value="valueFrom">From a binding</option>
        </select>
      </div>
      {source === 'value' ? (
        <div className="field-row">
          <label htmlFor={`${idPrefix}-value`}>Value</label>
          <input
            id={`${idPrefix}-value`}
            value={step.value ?? ''}
            onChange={(e) => onChange({ op: 'fill', selector: step.selector, value: e.target.value })}
            placeholder="2026-08-01"
          />
        </div>
      ) : (
        <div className="field-row">
          <label htmlFor={`${idPrefix}-valuefrom`}>Binding name</label>
          <input
            id={`${idPrefix}-valuefrom`}
            value={step.valueFrom ?? ''}
            onChange={(e) =>
              onChange({ op: 'fill', selector: step.selector, valueFrom: e.target.value })
            }
            placeholder="row.date"
          />
        </div>
      )}
    </>
  );
}

function SelectFields({ step, idPrefix, onChange }: FieldsProps<'select'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-selector`}>Selector</label>
        <input
          id={`${idPrefix}-selector`}
          value={step.selector}
          onChange={(e) => onChange({ ...step, selector: e.target.value })}
          placeholder="select#page-size"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-value`}>Value</label>
        <input
          id={`${idPrefix}-value`}
          value={step.value}
          onChange={(e) => onChange({ ...step, value: e.target.value })}
          placeholder="100"
        />
      </div>
    </>
  );
}

function PressFields({ step, idPrefix, onChange }: FieldsProps<'press'>) {
  return (
    <div className="field-row">
      <label htmlFor={`${idPrefix}-key`}>Key</label>
      <input
        id={`${idPrefix}-key`}
        value={step.key}
        onChange={(e) => onChange({ ...step, key: e.target.value })}
        placeholder="Enter"
      />
    </div>
  );
}

function ScrollFields({ step, idPrefix, onChange }: FieldsProps<'scroll'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-to`}>Scroll to</label>
        <select
          id={`${idPrefix}-to`}
          value={step.to}
          onChange={(e) =>
            onChange(
              e.target.value === 'element'
                ? { op: 'scroll', to: 'element', selector: step.selector ?? '' }
                : { op: 'scroll', to: 'bottom' },
            )
          }
        >
          <option value="bottom">bottom</option>
          <option value="element">element</option>
        </select>
      </div>
      {step.to === 'element' ? (
        <div className="field-row">
          <label htmlFor={`${idPrefix}-selector`}>Selector</label>
          <input
            id={`${idPrefix}-selector`}
            value={step.selector ?? ''}
            onChange={(e) => onChange({ op: 'scroll', to: 'element', selector: e.target.value })}
            placeholder="#footer"
          />
        </div>
      ) : null}
    </>
  );
}

function ExtractFields({ step, idPrefix, onChange }: FieldsProps<'extract'>) {
  function updateField(index: number, patch: Partial<ScrapeFieldSelector>) {
    const fields = step.fields.map((field, i) => {
      if (i !== index) return field;
      const next = { ...field, ...patch };
      if (next.attribute !== undefined && next.attribute.length === 0) delete next.attribute;
      return next;
    });
    onChange({ ...step, fields });
  }

  function toggleEmit(type: 'JSON' | 'CSV') {
    const current = step.emit ?? [];
    const next = current.includes(type)
      ? current.filter((value) => value !== type)
      : [...current, type];
    onChange(withOptional(step, 'emit', next.length > 0 ? next : undefined));
  }

  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-name`}>Dataset name</label>
        <input
          id={`${idPrefix}-name`}
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          placeholder="rows"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-rowselector`}>Row selector</label>
        <input
          id={`${idPrefix}-rowselector`}
          value={step.rowSelector ?? ''}
          onChange={(e) => onChange(withOptional(step, 'rowSelector', e.target.value))}
          placeholder="table tr"
        />
      </div>
      {step.fields.map((field, index) => (
        <div className="field-editor-row" key={index}>
          <div>
            <label htmlFor={`${idPrefix}-field-${index}-name`}>Field {index + 1} name</label>
            <input
              id={`${idPrefix}-field-${index}-name`}
              value={field.name}
              onChange={(e) => updateField(index, { name: e.target.value })}
              placeholder="title"
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-field-${index}-selector`}>Field {index + 1} selector</label>
            <input
              id={`${idPrefix}-field-${index}-selector`}
              value={field.selector}
              onChange={(e) => updateField(index, { selector: e.target.value })}
              placeholder="h2"
            />
          </div>
          <div>
            <label htmlFor={`${idPrefix}-field-${index}-attribute`}>
              Field {index + 1} attribute
            </label>
            <input
              id={`${idPrefix}-field-${index}-attribute`}
              value={field.attribute ?? ''}
              onChange={(e) => updateField(index, { attribute: e.target.value })}
              placeholder="href"
            />
          </div>
          <button
            type="button"
            className="secondary"
            aria-label={`Remove field ${index + 1}`}
            disabled={step.fields.length === 1}
            onClick={() => onChange({ ...step, fields: step.fields.filter((_, i) => i !== index) })}
          >
            Remove
          </button>
        </div>
      ))}
      <button
        type="button"
        className="secondary"
        onClick={() => onChange({ ...step, fields: [...step.fields, { name: '', selector: '' }] })}
      >
        Add field
      </button>
      <div className="field-row" style={{ marginTop: '0.75rem' }}>
        <label>Emit</label>
        <div className="inline">
          {EMIT_TYPES.map((type) => (
            <div className="checkbox-row" key={type}>
              <input
                id={`${idPrefix}-emit-${type}`}
                type="checkbox"
                checked={(step.emit ?? []).includes(type)}
                onChange={() => toggleEmit(type)}
              />
              <label htmlFor={`${idPrefix}-emit-${type}`} style={{ margin: 0 }}>
                {type}
              </label>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function CaptureFields({ step, idPrefix, onChange }: FieldsProps<'capture'>) {
  function toggleType(type: (typeof CAPTURE_TYPES)[number]) {
    const next = step.as.includes(type)
      ? step.as.filter((value) => value !== type)
      : [...step.as, type];
    onChange({ ...step, as: next });
  }

  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-name`}>Artifact name</label>
        <input
          id={`${idPrefix}-name`}
          value={step.name}
          onChange={(e) => onChange({ ...step, name: e.target.value })}
          placeholder="receipt-{{index}}"
        />
      </div>
      <div className="field-row">
        <label>Capture as</label>
        <div className="inline">
          {CAPTURE_TYPES.map((type) => (
            <div className="checkbox-row" key={type}>
              <input
                id={`${idPrefix}-as-${type}`}
                type="checkbox"
                checked={step.as.includes(type)}
                onChange={() => toggleType(type)}
              />
              <label htmlFor={`${idPrefix}-as-${type}`} style={{ margin: 0 }}>
                {type}
              </label>
            </div>
          ))}
        </div>
      </div>
      <div className="checkbox-row">
        <input
          id={`${idPrefix}-fullpage`}
          type="checkbox"
          checked={step.fullPage ?? false}
          onChange={(e) => onChange(withOptional(step, 'fullPage', e.target.checked || undefined))}
        />
        <label htmlFor={`${idPrefix}-fullpage`} style={{ margin: 0 }}>
          Full page
        </label>
      </div>
    </>
  );
}

function ForEachFields({ step, idPrefix, onChange }: FieldsProps<'forEach'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-rowselector`}>Row selector</label>
        <input
          id={`${idPrefix}-rowselector`}
          value={step.rowSelector}
          onChange={(e) => onChange({ ...step, rowSelector: e.target.value })}
          placeholder="table tbody tr"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-max`}>Max rows</label>
        <input
          id={`${idPrefix}-max`}
          value={step.max ?? ''}
          onChange={(e) => onChange(withOptional(step, 'max', numberOrUndefined(e.target.value)))}
          placeholder="No limit"
        />
      </div>
    </>
  );
}

function OpenLinkFields({ step, idPrefix, onChange }: FieldsProps<'openLink'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-selector`}>Selector</label>
        <input
          id={`${idPrefix}-selector`}
          value={step.selector}
          onChange={(e) => onChange({ ...step, selector: e.target.value })}
          placeholder="a.receipt-link"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-attribute`}>Link attribute</label>
        <input
          id={`${idPrefix}-attribute`}
          value={step.attribute ?? ''}
          onChange={(e) => onChange(withOptional(step, 'attribute', e.target.value))}
          placeholder="href"
        />
      </div>
    </>
  );
}

function PaginateFields({ step, idPrefix, onChange }: FieldsProps<'paginate'>) {
  return (
    <>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-nextselector`}>Next selector</label>
        <input
          id={`${idPrefix}-nextselector`}
          value={step.nextSelector}
          onChange={(e) => onChange({ ...step, nextSelector: e.target.value })}
          placeholder="a.pagination-next"
        />
      </div>
      <div className="field-row">
        <label htmlFor={`${idPrefix}-maxpages`}>Max pages</label>
        <input
          id={`${idPrefix}-maxpages`}
          value={step.maxPages}
          onChange={(e) => onChange({ ...step, maxPages: numberOrUndefined(e.target.value) ?? 0 })}
          placeholder="5"
        />
      </div>
    </>
  );
}

export function StepFields({
  step,
  idPrefix,
  onChange,
}: {
  step: Step;
  idPrefix: string;
  onChange: (step: Step) => void;
}) {
  switch (step.op) {
    case 'goto':
      return <GotoFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'waitFor':
      return <WaitForFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'click':
      return <ClickFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'fill':
      return <FillFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'select':
      return <SelectFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'press':
      return <PressFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'scroll':
      return <ScrollFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'extract':
      return <ExtractFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'capture':
      return <CaptureFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'forEach':
      return <ForEachFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'openLink':
      return <OpenLinkFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'paginate':
      return <PaginateFields step={step} idPrefix={idPrefix} onChange={onChange} />;
    case 'goBack':
      return <p className="muted">This step goes back one page. It has no fields.</p>;
  }
}
