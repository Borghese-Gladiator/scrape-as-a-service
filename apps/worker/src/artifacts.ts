import type { ArtifactType, StorageClient, StoragePutResult } from '@scraper/shared';
import { runObjectKey, ScrapeError } from '@scraper/shared';
import type { ScrapeDiagnostics } from './diagnostics.js';
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
  result: ScrapeResult,
): Promise<UploadedArtifact[]> {
  const uploaded: UploadedArtifact[] = [];
  for (const artifact of result.artifacts) {
    const name = artifact.name;
    const key = runObjectKey(runId, name);
    let put: StoragePutResult;
    try {
      put = await storage.put(key, artifact.body, artifact.contentType);
    } catch (err) {
      throw new ScrapeError('STORAGE_FAILED', `upload of ${key} failed`, { cause: err });
    }
    uploaded.push({ type: artifact.type, name, stepIndex: artifact.stepIndex, put });
  }
  return uploaded;
}

interface BuiltDiagnosticArtifact {
  type: ArtifactType;
  name: string;
  body: Buffer;
  contentType: string;
}

function buildDiagnosticArtifacts(
  diagnostics: ScrapeDiagnostics,
): BuiltDiagnosticArtifact[] {
  const built: BuiltDiagnosticArtifact[] = [];
  if (diagnostics.screenshot) {
    built.push({
      type: 'PNG',
      name: 'failure-screenshot.png',
      body: diagnostics.screenshot,
      contentType: 'image/png',
    });
  }
  if (diagnostics.html !== undefined) {
    built.push({
      type: 'HTML',
      name: 'failure-source.html',
      body: Buffer.from(diagnostics.html, 'utf8'),
      contentType: 'text/html',
    });
  }
  if (diagnostics.console !== undefined) {
    built.push({
      type: 'JSON',
      name: 'failure-console.json',
      body: Buffer.from(JSON.stringify(diagnostics.console, null, 2), 'utf8'),
      contentType: 'application/json',
    });
  }
  return built;
}

/**
 * Upload whatever a failed scrape managed to capture, under the same prefix.
 * These artifacts belong to no step, so `stepIndex` is -1.
 */
export async function uploadFailureDiagnostics(
  storage: StorageClient,
  runId: string,
  diagnostics: ScrapeDiagnostics,
): Promise<UploadedArtifact[]> {
  const uploaded: UploadedArtifact[] = [];
  for (const artifact of buildDiagnosticArtifacts(diagnostics)) {
    const put = await storage.put(
      runObjectKey(runId, artifact.name),
      artifact.body,
      artifact.contentType,
    );
    uploaded.push({ type: artifact.type, name: artifact.name, stepIndex: -1, put });
  }
  return uploaded;
}
