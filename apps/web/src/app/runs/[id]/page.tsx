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

  // A browser cannot put the API key on an `<a href>`, so the link is resolved
  // to a presigned object URL here, where the key is available.
  const links = new Map<string, string>();
  for (const artifact of run.artifacts) {
    try {
      links.set(artifact.id, await api.artifactPresignedUrl(artifact.id));
    } catch {
      links.set(artifact.id, api.artifactDownloadUrl(artifact.id));
    }
  }

  return (
    <div>
      <h1>Run {run.id.slice(0, 8)}</h1>
      <RunDetailLive
        initialRun={run}
        artifactDownloadUrl={(artifactId) =>
          links.get(artifactId) ?? api.artifactDownloadUrl(artifactId)
        }
        archiveUrl={api.runArchiveUrl(run.id)}
      />
    </div>
  );
}
