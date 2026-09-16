'use client';

import { useState } from 'react';
import type { ScrapeConfig } from '@/lib/types';
import { createProgram } from '@/lib/steps';
import { validateProgram } from '@/lib/program-validation';
import { StepProgramEditor } from './StepProgramEditor';

export interface DefinitionFormValue {
  name: string;
  url: string;
  config: ScrapeConfig;
}

export function DefinitionForm({
  initialValue,
  onSubmit,
  submitting = false,
  submitLabel = 'Create definition',
}: {
  initialValue?: DefinitionFormValue;
  onSubmit: (value: DefinitionFormValue) => void;
  submitting?: boolean;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initialValue?.name ?? '');
  const [url, setUrl] = useState(initialValue?.url ?? '');
  const [config, setConfig] = useState<ScrapeConfig>(initialValue?.config ?? createProgram());
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (name.trim().length === 0) {
      setError('Name is required');
      return;
    }
    if (url.trim().length === 0) {
      setError('URL is required');
      return;
    }
    if (jsonError !== null) {
      setError('Fix the program JSON before you save');
      return;
    }

    const result = validateProgram(config);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    onSubmit({ name: name.trim(), url: url.trim(), config: result.config });
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Scrape definition">
      <div className="field-row">
        <label htmlFor="def-name">Name</label>
        <input
          id="def-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="My scrape"
        />
      </div>

      <div className="field-row">
        <label htmlFor="def-url">URL</label>
        <input
          id="def-url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com"
        />
      </div>

      <StepProgramEditor
        config={config}
        onChange={setConfig}
        jsonError={jsonError}
        onJsonError={setJsonError}
      />

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={submitting || jsonError !== null}>
        {submitting ? 'Saving…' : submitLabel}
      </button>
    </form>
  );
}
