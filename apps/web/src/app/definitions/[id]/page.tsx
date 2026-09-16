'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RunList } from '@/components/RunList';
import { getApiClient } from '@/lib/api';
import type { ScrapeDefinition, ScrapeRun } from '@/lib/types';

export default function DefinitionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const api = getApiClient();

  const [definition, setDefinition] = useState<ScrapeDefinition | null>(null);
  const [runs, setRuns] = useState<ScrapeRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [def, runList] = await Promise.all([api.getDefinition(id), api.listRuns(id)]);
      setDefinition(def);
      setRuns(runList);
    } catch (err) {
      setError((err as Error).message);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleRun() {
    setRunning(true);
    setError(null);
    try {
      await api.triggerRun(id);
      setRuns(await api.listRuns(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setRunning(false);
    }
  }

  if (error && !definition) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }

  if (!definition) {
    return <p className="muted">Loading…</p>;
  }

  return (
    <div>
      <h1>{definition.name}</h1>
      <p className="muted">{definition.url}</p>
      <p>
        <Link href={`/definitions/${id}/edit`}>Edit definition</Link>
      </p>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <div className="card">
        <h2>Run now</h2>
        <button onClick={handleRun} disabled={running}>
          {running ? 'Starting…' : 'Run'}
        </button>
      </div>

      <div className="card">
        <h2>Step program</h2>
        <p className="muted">{definition.config.steps.length} steps</p>
        <ol>
          {definition.config.steps.map((step, index) => (
            <li key={index}>{step.op}</li>
          ))}
        </ol>
        <pre style={{ overflowX: 'auto' }}>{JSON.stringify(definition.config, null, 2)}</pre>
      </div>

      <div className="card">
        <h2>Run history</h2>
        <RunList runs={runs} />
      </div>
    </div>
  );
}
