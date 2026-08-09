import Link from 'next/link';
import { getApiClient } from '@/lib/api';
import type { ScrapeDefinition } from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function DefinitionsPage() {
  const api = getApiClient();
  let definitions: ScrapeDefinition[] = [];
  let error: string | null = null;
  try {
    definitions = await api.listDefinitions();
  } catch (err) {
    error = (err as Error).message;
  }

  return (
    <div>
      <div className="inline" style={{ justifyContent: 'space-between' }}>
        <h1>Definitions</h1>
        <Link href="/definitions/new">
          <button>New definition</button>
        </Link>
      </div>

      {error ? (
        <p className="error" role="alert">
          Could not load definitions: {error}
        </p>
      ) : definitions.length === 0 ? (
        <p className="muted">No definitions yet. Create one to get started.</p>
      ) : (
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL</th>
                <th>Fields</th>
                <th>Artifacts</th>
              </tr>
            </thead>
            <tbody>
              {definitions.map((def) => (
                <tr key={def.id}>
                  <td>
                    <Link href={`/definitions/${def.id}`}>{def.name}</Link>
                  </td>
                  <td className="muted">{def.url}</td>
                  <td>{def.config.fields.length}</td>
                  <td>{def.config.artifacts.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
