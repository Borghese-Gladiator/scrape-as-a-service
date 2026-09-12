'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ScheduleForm } from '@/components/ScheduleForm';
import { RunList } from '@/components/RunList';
import { getApiClient } from '@/lib/api';
import type {
  CreateScheduleInput,
  ScrapeDefinition,
  ScrapeRun,
  ScrapeSchedule,
} from '@/lib/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export default function DefinitionDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const api = getApiClient();

  const [definition, setDefinition] = useState<ScrapeDefinition | null>(null);
  const [schedules, setSchedules] = useState<ScrapeSchedule[]>([]);
  const [runs, setRuns] = useState<ScrapeRun[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [addingSchedule, setAddingSchedule] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [def, sched, runList] = await Promise.all([
        api.getDefinition(id),
        api.listSchedules(id),
        api.listRuns(id),
      ]);
      setDefinition(def);
      setSchedules(sched);
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

  async function handleAddSchedule(input: CreateScheduleInput) {
    setAddingSchedule(true);
    setError(null);
    try {
      await api.createSchedule(input);
      setSchedules(await api.listSchedules(id));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAddingSchedule(false);
    }
  }

  async function handleToggle(scheduleId: string, enabled: boolean) {
    setError(null);
    try {
      await api.toggleSchedule(scheduleId, enabled);
      setSchedules(await api.listSchedules(id));
    } catch (err) {
      setError((err as Error).message);
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
        <p className="muted">
          Version {definition.config.version} · {definition.config.steps.length} steps
        </p>
        <ol>
          {definition.config.steps.map((step, index) => (
            <li key={index}>{step.op}</li>
          ))}
        </ol>
        <pre style={{ overflowX: 'auto' }}>{JSON.stringify(definition.config, null, 2)}</pre>
      </div>

      <div className="card">
        <h2>Schedules</h2>
        {schedules.length === 0 ? (
          <p className="muted">No schedules yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Cron</th>
                <th>Timezone</th>
                <th>Enabled</th>
                <th>Next run</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {schedules.map((schedule) => (
                <tr key={schedule.id}>
                  <td>{schedule.cron}</td>
                  <td>{schedule.timezone}</td>
                  <td>{schedule.enabled ? 'Yes' : 'No'}</td>
                  <td>{formatDate(schedule.next_run_at)}</td>
                  <td>
                    <button
                      className="secondary"
                      onClick={() => handleToggle(schedule.id, !schedule.enabled)}
                    >
                      {schedule.enabled ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div style={{ marginTop: '1rem' }}>
          <h2>Add schedule</h2>
          <ScheduleForm
            definitionId={id}
            onSubmit={handleAddSchedule}
            submitting={addingSchedule}
          />
        </div>
      </div>

      <div className="card">
        <h2>Run history</h2>
        <RunList runs={runs} />
      </div>
    </div>
  );
}
