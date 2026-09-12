'use client';

import { useState } from 'react';
import type { AuthConfig, ScrapeConfig, Step } from '@/lib/types';
import { MAX_NESTING_DEPTH, withOptional } from '@/lib/steps';
import { AuthConfigEditor } from './AuthConfigEditor';
import { JsonProgramEditor } from './JsonProgramEditor';
import { StepTree } from './StepList';

type EditorMode = 'form' | 'json';

export function StepProgramEditor({
  config,
  onChange,
  jsonError,
  onJsonError,
}: {
  config: ScrapeConfig;
  onChange: (config: ScrapeConfig) => void;
  jsonError: string | null;
  onJsonError: (error: string | null) => void;
}) {
  const [mode, setMode] = useState<EditorMode>('form');

  function changeMode(next: EditorMode) {
    if (next === 'form') onJsonError(null);
    setMode(next);
  }

  return (
    <div>
      <div className="step-toolbar">
        <button
          type="button"
          className={mode === 'form' ? '' : 'secondary'}
          aria-pressed={mode === 'form'}
          disabled={jsonError !== null}
          onClick={() => changeMode('form')}
        >
          Form
        </button>
        <button
          type="button"
          className={mode === 'json' ? '' : 'secondary'}
          aria-pressed={mode === 'json'}
          onClick={() => changeMode('json')}
        >
          JSON
        </button>
      </div>

      {mode === 'json' ? (
        <JsonProgramEditor
          config={config}
          onChange={onChange}
          onError={onJsonError}
        />
      ) : (
        <>
          <div className="field-row">
            <h2>Authentication</h2>
            <AuthConfigEditor
              auth={config.auth ?? { mode: 'none' }}
              onChange={(auth: AuthConfig) => onChange({ ...config, auth })}
            />
          </div>

          <div className="field-row">
            <h2>Steps</h2>
            <p className="muted">
              The form editor nests {MAX_NESTING_DEPTH} levels deep. Use the JSON editor for a
              deeper program.
            </p>
            <StepTree
              steps={config.steps}
              onChange={(steps: Step[]) => onChange({ ...config, steps })}
              idScope="step"
              namePrefix="Step"
              addLabel="Add step"
            />
          </div>

          <div className="checkbox-row">
            <input
              id="program-record"
              type="checkbox"
              checked={config.record ?? false}
              onChange={(e) =>
                onChange(withOptional(config, 'record', e.target.checked || undefined))
              }
            />
            <label htmlFor="program-record" style={{ margin: 0 }}>
              Record the browser context as WEBM
            </label>
          </div>
        </>
      )}
    </div>
  );
}
