import { RUN_COMPLETE_STATUSES, type RunDetail as RunDetailType } from '@/lib/types';

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function RunDetail({
  run,
  artifactDownloadUrl,
}: {
  run: RunDetailType;
  artifactDownloadUrl: (artifactId: string) => string;
}) {
  const isComplete = RUN_COMPLETE_STATUSES.includes(run.status);

  return (
    <div>
      <div className="card">
        <h2>Status</h2>
        <p>
          <span className={`badge ${run.status}`}>{run.status}</span>
        </p>
        <p className="muted">
          Trigger: {run.trigger} · Created: {formatDate(run.created_at)} · Started:{' '}
          {formatDate(run.started_at)} · Finished: {formatDate(run.finished_at)}
        </p>
      </div>

      <div className="card">
        <h2>Attempts</h2>
        {run.attempts.length === 0 ? (
          <p className="muted">No attempts recorded yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Status</th>
                <th>Worker</th>
                <th>Started</th>
                <th>Finished</th>
                <th>Failure</th>
              </tr>
            </thead>
            <tbody>
              {run.attempts.map((attempt) => (
                <tr key={attempt.id}>
                  <td>{attempt.attempt_number}</td>
                  <td>
                    <span className={`badge ${attempt.status}`}>{attempt.status}</span>
                  </td>
                  <td>{attempt.worker_id ?? '—'}</td>
                  <td>{formatDate(attempt.started_at)}</td>
                  <td>{formatDate(attempt.finished_at)}</td>
                  <td>
                    {attempt.error_code || attempt.error_message ? (
                      <span className="error">
                        {attempt.error_code ? <strong>{attempt.error_code}: </strong> : null}
                        {attempt.error_message ?? ''}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h2>Artifacts</h2>
        {!isComplete ? (
          <p className="muted">Artifacts will be available once the run completes.</p>
        ) : run.artifacts.length === 0 ? (
          <p className="muted">No artifacts were produced for this run.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Size</th>
                <th>Download</th>
              </tr>
            </thead>
            <tbody>
              {run.artifacts.map((artifact) => (
                <tr key={artifact.id}>
                  <td>{artifact.name ?? '—'}</td>
                  <td>{artifact.type}</td>
                  <td>{formatBytes(artifact.size_bytes)}</td>
                  <td className="artifact-links">
                    <a href={artifactDownloadUrl(artifact.id)} download>
                      Download {artifact.type}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
