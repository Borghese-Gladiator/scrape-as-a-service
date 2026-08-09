'use client';

import { useState } from 'react';
import type { CreateScheduleInput } from '@/lib/types';

const COMMON_TIMEZONES = [
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Kolkata',
  'Australia/Sydney',
];

export function ScheduleForm({
  definitionId,
  onSubmit,
  submitting = false,
}: {
  definitionId: string;
  onSubmit: (input: CreateScheduleInput) => void;
  submitting?: boolean;
}) {
  const [cron, setCron] = useState('0 * * * *');
  const [timezone, setTimezone] = useState('UTC');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (cron.trim().length === 0) {
      setError('Cron expression is required');
      return;
    }
    onSubmit({ definitionId, cron: cron.trim(), timezone, enabled });
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Add schedule">
      <div className="field-row">
        <label htmlFor="schedule-cron">Cron expression</label>
        <input
          id="schedule-cron"
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          placeholder="0 * * * *"
        />
      </div>

      <div className="field-row">
        <label htmlFor="schedule-timezone">Timezone</label>
        <select
          id="schedule-timezone"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
        >
          {COMMON_TIMEZONES.map((tz) => (
            <option key={tz} value={tz}>
              {tz}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row checkbox-row">
        <input
          id="schedule-enabled"
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <label htmlFor="schedule-enabled" style={{ margin: 0 }}>
          Enabled
        </label>
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}

      <button type="submit" disabled={submitting}>
        {submitting ? 'Adding…' : 'Add schedule'}
      </button>
    </form>
  );
}
