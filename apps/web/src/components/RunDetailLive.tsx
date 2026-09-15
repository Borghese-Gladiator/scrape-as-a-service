'use client';

import { useEffect, useMemo, useState } from 'react';
import { getApiClient } from '@/lib/api';
import { RUN_COMPLETE_STATUSES, type RunDetail as RunDetailType } from '@/lib/types';
import { RunDetail } from './RunDetail';

export const POLL_INTERVAL_MS = 2000;

/**
 * Keeps the server-rendered run fresh. The page is still rendered on the
 * server; this only re-polls while the run can still change, and the API
 * client is built in the browser so it resolves the public base URL.
 */
export function RunDetailLive({
  initialRun,
  artifactDownloadUrl,
}: {
  initialRun: RunDetailType;
  artifactDownloadUrl?: (artifactId: string) => string;
}) {
  const api = useMemo(() => getApiClient(), []);
  const [run, setRun] = useState(initialRun);
  const isLive = !RUN_COMPLETE_STATUSES.includes(run.status);
  const runId = run.id;

  useEffect(() => {
    if (!isLive) return;

    let cancelled = false;
    const timer = setInterval(() => {
      api
        .getRun(runId)
        .then((next) => {
          if (!cancelled) setRun(next);
        })
        .catch(() => {
          // a transient API error must not clear the last good render
        });
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [api, isLive, runId]);

  return (
    <div>
      {isLive ? (
        <p className="muted" role="status">
          Live — this page refreshes every 2 seconds.
        </p>
      ) : null}
      <RunDetail
        run={run}
        artifactDownloadUrl={artifactDownloadUrl ?? ((id) => api.artifactDownloadUrl(id))}
      />
    </div>
  );
}
