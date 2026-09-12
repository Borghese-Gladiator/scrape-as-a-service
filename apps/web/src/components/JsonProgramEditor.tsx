'use client';

import { useState } from 'react';
import type { ScrapeConfig } from '@/lib/types';
import { parseProgramText } from '@/lib/program-validation';

export function JsonProgramEditor({
  config,
  onChange,
  onError,
}: {
  config: ScrapeConfig;
  onChange: (config: ScrapeConfig) => void;
  onError: (error: string | null) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [error, setError] = useState<string | null>(null);

  function handleBlur() {
    const result = parseProgramText(text);
    if (result.ok) {
      setError(null);
      onError(null);
      onChange(result.config);
      return;
    }
    setError(result.error);
    onError(result.error);
  }

  return (
    <div className="field-row">
      <label htmlFor="program-json">Program JSON</label>
      <textarea
        id="program-json"
        className="json-editor"
        rows={20}
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={handleBlur}
      />
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : (
        <p className="muted">The program is checked when the editor loses focus.</p>
      )}
    </div>
  );
}
