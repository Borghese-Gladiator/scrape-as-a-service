import { getApiClient } from '@/lib/api';
import { RunList } from '@/components/RunList';
import type { ScrapeRun } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  const api = getApiClient();
  let runs: ScrapeRun[] = [];
  let error: string | null = null;
  try {
    runs = await api.listRuns();
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <h1>Run history</h1>
      {error ? (
        <p className="error" role="alert">
          Could not load runs: {error}
        </p>
      ) : (
        <div className="card">
          <RunList runs={runs} />
        </div>
      )}
    </div>
  );
}
