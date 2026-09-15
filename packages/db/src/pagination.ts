export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 200;

export interface Keyed {
  id: string;
  created_at: Date;
}

export interface Cursor {
  createdAt: Date;
  id: string;
}

/** Clamp a caller limit into `1..MAX_PAGE_LIMIT`. A bad value takes the default. */
export function resolveLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_PAGE_LIMIT;
  const whole = Math.floor(limit);
  if (whole < 1) return 1;
  return Math.min(whole, MAX_PAGE_LIMIT);
}

export function encodeCursor(row: Keyed): string {
  return Buffer.from(`${new Date(row.created_at).toISOString()}|${row.id}`, 'utf8').toString(
    'base64url',
  );
}

/** Return null for an unreadable cursor, so a stale link degrades to page one. */
export function decodeCursor(cursor: string | undefined): Cursor | null {
  if (cursor === undefined || cursor.length === 0) return null;
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const separator = decoded.indexOf('|');
  if (separator === -1) return null;
  const createdAt = new Date(decoded.slice(0, separator));
  const id = decoded.slice(separator + 1);
  if (Number.isNaN(createdAt.getTime()) || id.length === 0) return null;
  return { createdAt, id };
}

/**
 * Take one row more than the caller asked for. The extra row proves another
 * page exists without a second count query.
 */
export function toPage<T extends Keyed>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: last ? encodeCursor(last) : null };
}
