import type {
  ApiClient,
  Artifact,
  CreateDefinitionInput,
  CreateScheduleInput,
  RunDetail,
  ScrapeDefinition,
  ScrapeRun,
  ScrapeSchedule,
} from './types';

const DEFAULT_BASE_URL = 'http://localhost:4000';

function resolveBaseUrl(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, '');

  const publicUrl = process.env.NEXT_PUBLIC_API_BASE_URL;

  // Server-side (SSR/RSC) requests run inside the web container and must reach
  // the api service over the internal Docker network. API_BASE_URL is a
  // server-only, non-inlined var (e.g. http://api:4000). In the browser we use
  // the public, host-reachable URL (e.g. http://localhost:4000).
  if (typeof window === 'undefined') {
    const internal = process.env.API_BASE_URL;
    const chosen = internal || publicUrl || DEFAULT_BASE_URL;
    return chosen.replace(/\/$/, '');
  }

  return (publicUrl && publicUrl.length > 0 ? publicUrl : DEFAULT_BASE_URL).replace(/\/$/, '');
}

/**
 * Always the browser-reachable base URL. Used for links/URLs that are rendered
 * into the page (e.g. artifact download hrefs) — these are followed by the
 * browser even when produced during server-side rendering, so they must never
 * use the internal Docker network address.
 */
function resolvePublicBaseUrl(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit.replace(/\/$/, '');
  const publicUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  return (publicUrl && publicUrl.length > 0 ? publicUrl : DEFAULT_BASE_URL).replace(/\/$/, '');
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      message = body.error ?? body.message ?? message;
    } catch {
      // response had no JSON body
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function getApiClient(baseUrl?: string): ApiClient {
  const base = resolveBaseUrl(baseUrl);
  const publicBase = resolvePublicBaseUrl(baseUrl);

  return {
    listDefinitions() {
      return request<ScrapeDefinition[]>(`${base}/definitions`);
    },
    async getDefinition(id: string) {
      const all = await request<ScrapeDefinition[]>(`${base}/definitions`);
      const found = all.find((d) => d.id === id);
      if (!found) throw new Error('definition not found');
      return found;
    },
    createDefinition(input: CreateDefinitionInput) {
      return request<ScrapeDefinition>(`${base}/definitions`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    listSchedules(definitionId?: string) {
      const query = definitionId ? `?definitionId=${encodeURIComponent(definitionId)}` : '';
      return request<ScrapeSchedule[]>(`${base}/schedules${query}`);
    },
    createSchedule(input: CreateScheduleInput) {
      return request<ScrapeSchedule>(`${base}/schedules`, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    toggleSchedule(id: string, enabled: boolean) {
      return request<ScrapeSchedule>(`${base}/schedules/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ enabled }),
      });
    },
    triggerRun(definitionId: string) {
      return request<ScrapeRun>(`${base}/runs`, {
        method: 'POST',
        body: JSON.stringify({ definitionId }),
      });
    },
    listRuns(definitionId?: string) {
      const query = definitionId ? `?definitionId=${encodeURIComponent(definitionId)}` : '';
      return request<ScrapeRun[]>(`${base}/runs${query}`);
    },
    getRun(id: string) {
      return request<RunDetail>(`${base}/runs/${encodeURIComponent(id)}`);
    },
    listArtifacts(runId: string) {
      return request<Artifact[]>(`${base}/runs/${encodeURIComponent(runId)}/artifacts`);
    },
    artifactDownloadUrl(artifactId: string) {
      return `${publicBase}/artifacts/${encodeURIComponent(artifactId)}/download`;
    },
  };
}
