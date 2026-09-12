export interface ParsedArgs {
  flags: Record<string, string>;
  switches: Set<string>;
}

/**
 * Parse `--name value` and `--name`. A bare switch is any flag whose next
 * token starts with `--`, or that ends the list.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const flags: Record<string, string> = {};
  const switches = new Set<string>();

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) continue;
    const [name, inline] = splitInline(token.slice(2));
    if (inline !== undefined) {
      flags[name] = inline;
      continue;
    }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      switches.add(name);
      continue;
    }
    flags[name] = next;
    i += 1;
  }
  return { flags, switches };
}

function splitInline(token: string): [string, string | undefined] {
  const equals = token.indexOf('=');
  if (equals === -1) return [token, undefined];
  return [token.slice(0, equals), token.slice(equals + 1)];
}

export function requireFlag(args: ParsedArgs, name: string): string {
  const value = args.flags[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`--${name} is required`);
  }
  return value;
}

export function integerFlag(args: ParsedArgs, name: string): number | undefined {
  const value = args.flags[name];
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`--${name} must be a positive integer`);
  }
  return parsed;
}
