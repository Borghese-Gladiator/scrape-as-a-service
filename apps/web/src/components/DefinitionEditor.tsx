'use client';

import { useEffect, useState } from 'react';
import { getApiClient } from '@/lib/api';
import type { ApiClient, ScrapeDefinition } from '@/lib/types';
import { DefinitionForm, type DefinitionFormValue } from './DefinitionForm';

export function DefinitionEditor({
  id,
  api = getApiClient(),
  onSaved,
}: {
  id: string;
  api?: ApiClient;
  onSaved?: (definition: ScrapeDefinition) => void;
}) {
  const [definition, setDefinition] = useState<ScrapeDefinition | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .getDefinition(id)
      .then((loaded) => {
        if (active) setDefinition(loaded);
      })
      .catch((err: Error) => {
        if (active) setError(err.message);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function handleSubmit(value: DefinitionFormValue) {
    setSaving(true);
    setError(null);
    try {
      const saved = await api.updateDefinition(id, value);
      setDefinition(saved);
      onSaved?.(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!definition) {
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p className="muted">Loading…</p>
    );
  }

  return (
    <div className="card">
      <DefinitionForm
        initialValue={{ name: definition.name, url: definition.url, config: definition.config }}
        onSubmit={handleSubmit}
        submitting={saving}
        submitLabel="Save definition"
      />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
