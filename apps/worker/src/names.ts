export interface NameBindings {
  index?: number;
  page?: number;
  row?: Record<string, string | null>;
}

const PLACEHOLDER = /\{\{\s*([A-Za-z0-9_. -]+)\s*\}\}/g;
const MAX_NAME_LENGTH = 120;

/**
 * Resolve `{{index}}`, `{{page}}`, and `{{row.<field>}}` against the current
 * bindings. The grammar holds nothing else: no expression and no function call
 * can reach the interpreter.
 */
export function resolveNameTemplate(template: string, bindings: NameBindings): string {
  return template.replace(PLACEHOLDER, (_match, rawKey: string) => {
    const key = rawKey.trim();
    if (key === 'index') return bindings.index === undefined ? '' : String(bindings.index);
    if (key === 'page') return bindings.page === undefined ? '' : String(bindings.page);
    if (key.startsWith('row.')) {
      const field = key.slice('row.'.length);
      return bindings.row?.[field] ?? '';
    }
    return '';
  });
}

/** Reduce a resolved template to a safe, flat filename base. */
export function sanitizeArtifactName(name: string): string {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
    .slice(0, MAX_NAME_LENGTH)
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '');
  return cleaned.length === 0 ? 'capture' : cleaned;
}

/**
 * Return `<base><extension>`, with `-2`, `-3` and so on appended to the base
 * when the run already holds that filename. `used` carries the run state.
 */
export function uniqueArtifactName(
  base: string,
  extension: string,
  used: Map<string, number>,
): string {
  const key = `${base}${extension}`;
  const seen = used.get(key) ?? 0;
  used.set(key, seen + 1);
  if (seen === 0) return key;

  let suffix = seen + 1;
  let candidate = `${base}-${suffix}${extension}`;
  while (used.has(candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}${extension}`;
  }
  used.set(candidate, 1);
  return candidate;
}
