import type {
  ArtifactType,
  ScrapeConfig,
  StorageClient,
  StoragePutResult,
} from '@scraper/shared';
import { runObjectKey } from '@scraper/shared';
import type { ScrapeResult } from './interpreter.js';

function csvEscape(value: string | null): string {
  const s = value ?? '';
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Serialize extracted rows to CSV bytes. Header is the union of row keys. */
export function toCsv(rows: Record<string, string | null>[]): Buffer {
  if (rows.length === 0) {
    return Buffer.from('', 'utf8');
  }
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h] ?? null)).join(','));
  }
  return Buffer.from(lines.join('\n'), 'utf8');
}

/**
 * A config that `upgradeScrapeConfig` produced names its extract `rows` and its
 * capture `page`. Map those back to the v1 filenames, so an old definition
 * keeps producing the files its consumers expect.
 */
const V1_ARTIFACT_NAMES: Record<string, string> = {
  'rows.json': 'data.json',
  'rows.csv': 'data.csv',
  'page.png': 'screenshot.png',
  'page.html': 'source.html',
};

export function artifactFilename(config: ScrapeConfig, name: string): string {
  if (config.upgradedFrom !== 1) return name;
  return V1_ARTIFACT_NAMES[name] ?? name;
}

export interface UploadedArtifact {
  type: ArtifactType;
  name: string;
  stepIndex: number;
  put: StoragePutResult;
}

/** Upload every captured artifact to MinIO under runs/<run-id>/. */
export async function buildAndUploadArtifacts(
  storage: StorageClient,
  runId: string,
  config: ScrapeConfig,
  result: ScrapeResult,
): Promise<UploadedArtifact[]> {
  const uploaded: UploadedArtifact[] = [];
  for (const artifact of result.artifacts) {
    const name = artifactFilename(config, artifact.name);
    const put = await storage.put(
      runObjectKey(runId, name),
      artifact.body,
      artifact.contentType,
    );
    uploaded.push({ type: artifact.type, name, stepIndex: artifact.stepIndex, put });
  }
  return uploaded;
}
