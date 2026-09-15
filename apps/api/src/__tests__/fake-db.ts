import type { Pool, QueryResult, QueryResultRow } from 'pg';

export interface DefinitionRow extends QueryResultRow {
  id: string;
  name: string;
  url: string;
  config: unknown;
  created_at: Date;
  deleted_at: Date | null;
}

export interface RunRow extends QueryResultRow {
  id: string;
  definition_id: string;
  schedule_id: string | null;
  status: string;
  trigger: string;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

export interface ArtifactRow extends QueryResultRow {
  id: string;
  run_id: string;
  type: string;
  name: string | null;
  step_index: number | null;
  object_key: string;
  content_type: string;
  size_bytes: number;
  created_at: Date;
}

export interface AttemptRow extends QueryResultRow {
  id: string;
  run_id: string;
  attempt_number: number;
  status: string;
  worker_id: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: Date;
  finished_at: Date | null;
}

export interface FakeData {
  definitions?: DefinitionRow[];
  runs?: RunRow[];
  artifacts?: ArtifactRow[];
  attempts?: AttemptRow[];
}

/**
 * An in-memory stand-in for the repository queries the routes issue. It
 * matches on the SQL text, the same way the existing route tests do.
 */
export class FakeDb {
  readonly definitions: DefinitionRow[];
  readonly runs: RunRow[];
  readonly artifacts: ArtifactRow[];
  readonly attempts: AttemptRow[];
  readonly queries: { text: string; values: unknown[] }[] = [];
  private seq = 0;

  constructor(data: FakeData = {}) {
    this.definitions = data.definitions ?? [];
    this.runs = data.runs ?? [];
    this.artifacts = data.artifacts ?? [];
    this.attempts = data.attempts ?? [];
  }

  asPool(): Pool {
    return this as unknown as Pool;
  }

  async query<R extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<R>> {
    this.queries.push({ text, values });
    const rows = this.dispatch(text, values) as R[];
    return { rows, command: '', rowCount: rows.length, oid: 0, fields: [] };
  }

  private dispatch(text: string, values: unknown[]): QueryResultRow[] {
    if (text.includes('FROM scrape_definitions') && text.includes('deleted_at IS NULL')) {
      return this.pageOf(
        this.definitions.filter((row) => row.deleted_at === null),
        text,
        values,
      );
    }
    if (text.includes('FROM scrape_definitions')) {
      return this.definitions.filter((row) => row.id === values[0]);
    }
    if (text.includes('UPDATE scrape_definitions') && text.includes('deleted_at = $2')) {
      const row = this.definitions.find(
        (d) => d.id === values[0] && d.deleted_at === null,
      );
      if (!row) return [];
      row.deleted_at = values[1] as Date;
      return [row];
    }
    if (text.includes('UPDATE scrape_definitions')) {
      const row = this.definitions.find(
        (d) => d.id === values[0] && d.deleted_at === null,
      );
      if (!row) return [];
      if (values[1] !== null) row.name = values[1] as string;
      if (values[2] !== null) row.url = values[2] as string;
      if (values[3] !== null) row.config = JSON.parse(values[3] as string);
      return [row];
    }

    if (text.includes('INSERT INTO scrape_runs')) {
      this.seq += 1;
      const row: RunRow = {
        id: `run-new-${this.seq}`,
        definition_id: values[0] as string,
        schedule_id: (values[1] as string | null) ?? null,
        status: 'QUEUED',
        trigger: values[2] as string,
        created_at: new Date(),
        started_at: null,
        finished_at: null,
      };
      this.runs.push(row);
      return [row];
    }
    if (text.includes('UPDATE scrape_runs')) {
      const row = this.runs.find((r) => r.id === values[0]);
      if (!row) return [];
      row.status = values[1] as string;
      row.finished_at = values[2] as Date;
      return [row];
    }
    if (text.includes('FROM scrape_runs') && text.includes('WHERE id = $1')) {
      return this.runs.filter((row) => row.id === values[0]);
    }
    if (text.includes('FROM scrape_runs')) {
      return this.pageOf(this.filterRuns(text, values), text, values);
    }

    if (text.includes('FROM artifacts') && text.includes('run_id = $1')) {
      return this.artifacts.filter((row) => row.run_id === values[0]);
    }
    if (text.includes('FROM artifacts')) {
      return this.artifacts.filter((row) => row.id === values[0]);
    }

    if (text.includes('INSERT INTO scrape_run_attempts')) {
      this.seq += 1;
      const row: AttemptRow = {
        id: `attempt-new-${this.seq}`,
        run_id: values[0] as string,
        attempt_number: this.attempts.filter((a) => a.run_id === values[0]).length + 1,
        status: 'RUNNING',
        worker_id: values[1] as string,
        error_code: null,
        error_message: null,
        started_at: new Date(),
        finished_at: null,
      };
      this.attempts.push(row);
      return [row];
    }
    if (
      text.includes('UPDATE scrape_run_attempts') &&
      text.includes("status = 'RUNNING'")
    ) {
      const matched = this.attempts.filter(
        (a) => a.run_id === values[0] && a.status === 'RUNNING',
      );
      for (const row of matched) {
        row.status = 'FAILED';
        row.error_code = values[1] as string;
        row.error_message = values[2] as string;
        row.finished_at = new Date();
      }
      return matched;
    }
    if (text.includes('UPDATE scrape_run_attempts')) {
      const row = this.attempts.find((a) => a.id === values[0]);
      if (!row) return [];
      row.status = values[1] as string;
      row.error_code = (values[2] as string | null) ?? null;
      row.error_message = (values[3] as string | null) ?? null;
      row.finished_at = new Date();
      return [row];
    }
    if (text.includes('FROM scrape_run_attempts')) {
      return this.attempts.filter((row) => row.run_id === values[0]);
    }
    if (text.includes('FROM scrape_schedules')) {
      return [];
    }

    throw new Error(`Unhandled query: ${text}`);
  }

  private filterRuns(text: string, values: unknown[]): RunRow[] {
    let rows = [...this.runs];
    let index = 0;
    if (text.includes('definition_id = $')) {
      const definitionId = values[index];
      index += 1;
      rows = rows.filter((row) => row.definition_id === definitionId);
    }
    if (text.includes('status = $')) {
      const status = values[index];
      rows = rows.filter((row) => row.status === status);
    }
    return rows;
  }

  /** Apply the keyset predicate, the order, and the LIMIT the caller asked for. */
  private pageOf<T extends { id: string; created_at: Date }>(
    rows: T[],
    text: string,
    values: unknown[],
  ): T[] {
    const limit = values[values.length - 1] as number;
    let page = [...rows].sort((a, b) => {
      const byTime = b.created_at.getTime() - a.created_at.getTime();
      return byTime !== 0 ? byTime : a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    if (text.includes('(created_at, id) <')) {
      const createdAt = values[values.length - 3] as Date;
      const id = values[values.length - 2] as string;
      page = page.filter(
        (row) =>
          row.created_at.getTime() < createdAt.getTime() ||
          (row.created_at.getTime() === createdAt.getTime() && row.id < id),
      );
    }
    return page.slice(0, limit);
  }
}

export function definitionRow(overrides: Partial<DefinitionRow> = {}): DefinitionRow {
  return {
    id: 'def-1',
    name: 'A definition',
    url: 'https://example.com',
    config: { version: 2, steps: [{ op: 'goto' }] },
    created_at: new Date('2026-01-01T00:00:00Z'),
    deleted_at: null,
    ...overrides,
  };
}

export function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run-1',
    definition_id: 'def-1',
    schedule_id: null,
    status: 'QUEUED',
    trigger: 'MANUAL',
    created_at: new Date('2026-01-01T00:00:00Z'),
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

export function artifactRow(overrides: Partial<ArtifactRow> = {}): ArtifactRow {
  return {
    id: 'artifact-1',
    run_id: 'run-1',
    type: 'PNG',
    name: 'receipt-0.png',
    step_index: 1,
    object_key: 'runs/run-1/receipt-0.png',
    content_type: 'image/png',
    size_bytes: 10,
    created_at: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}
