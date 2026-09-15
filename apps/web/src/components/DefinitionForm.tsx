'use client';

import { useState } from 'react';
import {
  V1_ARTIFACT_TYPES,
  type ArtifactType,
  type CreateDefinitionInput,
  type ScrapeFieldSelector,
} from '@/lib/types';

interface FieldRow {
  name: string;
  selector: string;
  attribute: string;
}

const EMPTY_FIELD: FieldRow = { name: '', selector: '', attribute: '' };

export function DefinitionForm({
  onSubmit,
  submitting = false,
}: {
  onSubmit: (input: CreateDefinitionInput) => void;
  submitting?: boolean;
}) {
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [waitFor, setWaitFor] = useState('');
  const [rowSelector, setRowSelector] = useState('');
  const [fields, setFields] = useState<FieldRow[]>([{ ...EMPTY_FIELD }]);
  const [artifacts, setArtifacts] = useState<ArtifactType[]>(['JSON']);
  const [error, setError] = useState<string | null>(null);

  function updateField(index: number, patch: Partial<FieldRow>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function addField() {
    setFields((prev) => [...prev, { ...EMPTY_FIELD }]);
  }

  function removeField(index: number) {
    setFields((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== index)));
  }

  function toggleArtifact(type: ArtifactType) {
    setArtifacts((prev) =>
      prev.includes(type) ? prev.filter((a) => a !== type) : [...prev, type],
    );
  }

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

    const parsedFields: ScrapeFieldSelector[] = [];
    for (const f of fields) {
      if (f.name.trim().length === 0 && f.selector.trim().length === 0) continue;
      if (f.name.trim().length === 0 || f.selector.trim().length === 0) {
        setError('Each field needs both a name and a selector');
        return;
      }
      const field: ScrapeFieldSelector = { name: f.name.trim(), selector: f.selector.trim() };
      if (f.attribute.trim().length > 0) field.attribute = f.attribute.trim();
      parsedFields.push(field);
    }

    if (parsedFields.length === 0) {
      setError('At least one field selector is required');
      return;
    }

    const config: CreateDefinitionInput['config'] = {
      fields: parsedFields,
      artifacts,
    };
    if (waitFor.trim().length > 0) config.waitFor = waitFor.trim();
    if (rowSelector.trim().length > 0) config.rowSelector = rowSelector.trim();

    onSubmit({ name: name.trim(), url: url.trim(), config });
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Create scrape definition">
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

      <div className="field-row">
        <label htmlFor="def-waitfor">Wait for selector (optional)</label>
        <input
          id="def-waitfor"
          value={waitFor}
          onChange={(e) => setWaitFor(e.target.value)}
          placeholder=".content-loaded"
        />
      </div>

      <div className="field-row">
        <label htmlFor="def-rowselector">Row selector (optional)</label>
        <input
          id="def-rowselector"
          value={rowSelector}
          onChange={(e) => setRowSelector(e.target.value)}
          placeholder="table tr"
        />
      </div>

      <div className="field-row">
        <label>Field selectors</label>
        {fields.map((field, index) => (
          <div className="field-editor-row" key={index}>
            <div>
              <label htmlFor={`field-name-${index}`}>Field name</label>
              <input
                id={`field-name-${index}`}
                value={field.name}
                onChange={(e) => updateField(index, { name: e.target.value })}
                placeholder="title"
              />
            </div>
            <div>
              <label htmlFor={`field-selector-${index}`}>Selector</label>
              <input
                id={`field-selector-${index}`}
                value={field.selector}
                onChange={(e) => updateField(index, { selector: e.target.value })}
                placeholder="h1"
              />
            </div>
            <div>
              <label htmlFor={`field-attribute-${index}`}>Attribute (optional)</label>
              <input
                id={`field-attribute-${index}`}
                value={field.attribute}
                onChange={(e) => updateField(index, { attribute: e.target.value })}
                placeholder="href"
              />
            </div>
            <button
              type="button"
              className="secondary"
              onClick={() => removeField(index)}
              aria-label={`Remove field ${index + 1}`}
              disabled={fields.length === 1}
            >
              Remove
            </button>
          </div>
        ))}
        <button type="button" className="secondary" onClick={addField}>
          Add field
        </button>
      </div>

      <div className="field-row">
        <label>Requested artifacts</label>
        <div className="inline">
          {V1_ARTIFACT_TYPES.map((type) => (
            <div className="checkbox-row" key={type}>
              <input
                id={`artifact-${type}`}
                type="checkbox"
                checked={artifacts.includes(type)}
                onChange={() => toggleArtifact(type)}
              />
              <label htmlFor={`artifact-${type}`} style={{ margin: 0 }}>
                {type}
              </label>
            </div>
          ))}
        </div>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Creating…' : 'Create definition'}
      </button>
    </form>
  );
}
