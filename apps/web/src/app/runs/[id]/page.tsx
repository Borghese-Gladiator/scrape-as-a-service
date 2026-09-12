import { getApiClient } from '@/lib/api';
import { RunDetailLive } from '@/components/RunDetailLive';
import type { RunDetail as RunDetailType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function RunDetailPage({ params }: { params: { id: string } }) {
  const api = getApiClient();
  let run: RunDetailType | null = null;
  let error: string | null = null;
  try {
    run = await api.getRun(params.id);
  } catch (err) {
    error = (err as Error).message;
  }

  if (error || !run) {
    return (
      <p className="error" role="alert">
        Could not load run: {error ?? 'not found'}
      </p>
    );
  }

  return (
    <div>
      <h1>Run {run.id.slice(0, 8)}</h1>
      <RunDetailLive initialRun={run} />
    </div>
  );
}
