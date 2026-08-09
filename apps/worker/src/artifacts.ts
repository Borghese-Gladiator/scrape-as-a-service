import type {
  ArtifactType,
  ScrapeConfig,
  ScrapeResult,
  StorageClient,
  StoragePutResult,
} from '@scraper/shared';
import { runObjectKey } from '@scraper/shared';

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

interface BuiltArtifact {
  type: ArtifactType;
  filename: string;
  body: Buffer;
  contentType: string;
}

function buildArtifacts(config: ScrapeConfig, result: ScrapeResult): BuiltArtifact[] {
  const built: BuiltArtifact[] = [];
  for (const type of config.artifacts) {
    switch (type) {
      case 'JSON':
        built.push({
          type,
          filename: 'data.json',
          body: Buffer.from(JSON.stringify(result.rows, null, 2), 'utf8'),
          contentType: 'application/json',
        });
        break;
      case 'CSV':
        built.push({
          type,
          filename: 'data.csv',
          body: toCsv(result.rows),
          contentType: 'text/csv',
        });
        break;
      case 'PNG':
        if (result.screenshot) {
          built.push({
            type,
            filename: 'screenshot.png',
            body: result.screenshot,
            contentType: 'image/png',
          });
        }
        break;
      case 'HTML':
        if (result.html !== undefined) {
          built.push({
            type,
            filename: 'source.html',
            body: Buffer.from(result.html, 'utf8'),
            contentType: 'text/html',
          });
        }
        break;
      case 'WEBM':
        if (result.recording) {
          built.push({
            type,
            filename: 'recording.webm',
            body: result.recording,
            contentType: 'video/webm',
          });
        }
        break;
    }
  }
  return built;
}

/** Serialize requested artifacts and upload each to MinIO under runs/<run-id>/. */
export async function buildAndUploadArtifacts(
  storage: StorageClient,
  runId: string,
  config: ScrapeConfig,
  result: ScrapeResult,
): Promise<Array<{ type: ArtifactType; put: StoragePutResult }>> {
  const built = buildArtifacts(config, result);
  const uploaded: Array<{ type: ArtifactType; put: StoragePutResult }> = [];
  for (const artifact of built) {
    const key = runObjectKey(runId, artifact.filename);
    const put = await storage.put(key, artifact.body, artifact.contentType);
    uploaded.push({ type: artifact.type, put });
  }
  return uploaded;
}
