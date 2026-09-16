import Link from 'next/link';
import type { ScrapeRun } from '@/lib/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function RunList({ runs }: { runs: ScrapeRun[] }) {
  if (runs.length === 0) {
    return <p className="muted">No runs yet.</p>;
  }

  return (
    <table>
      <thead>
        <tr>
          <th>Run</th>
          <th>Status</th>
          <th>Trigger</th>
          <th>Created</th>
          <th>Finished</th>
        </tr>
      </thead>
      <tbody>
        {runs.map((run) => (
          <tr key={run.id}>
            <td>
              <Link href={`/runs/${run.id}`}>{run.id.slice(0, 8)}</Link>
            </td>
            <td>
              <span className={`badge ${run.status}`}>{run.status}</span>
            </td>
            <td>{run.trigger}</td>
            <td>{formatDate(run.created_at)}</td>
            <td>{formatDate(run.finished_at)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
