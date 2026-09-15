import { lookup } from 'node:dns/promises';

export class UrlNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'URL_NOT_ALLOWED';
  }
}

export interface UrlGuardOptions {
  /** Turn off the address check. The scheme check always stays on. */
  allowPrivate?: boolean;
  /** Resolve a host to its addresses. The default uses `node:dns`. */
  resolveHost?: (hostname: string) => Promise<string[]>;
}

const ALLOWED_PROTOCOLS = ['http:', 'https:'];

interface Cidr4 {
  base: number;
  bits: number;
}

/** Every IPv4 block that is not globally routable. */
const BLOCKED_V4: Cidr4[] = [
  { base: toV4Number([0, 0, 0, 0]), bits: 8 },
  { base: toV4Number([10, 0, 0, 0]), bits: 8 },
  { base: toV4Number([100, 64, 0, 0]), bits: 10 },
  { base: toV4Number([127, 0, 0, 0]), bits: 8 },
  { base: toV4Number([169, 254, 0, 0]), bits: 16 },
  { base: toV4Number([172, 16, 0, 0]), bits: 12 },
  { base: toV4Number([192, 0, 0, 0]), bits: 24 },
  { base: toV4Number([192, 0, 2, 0]), bits: 24 },
  { base: toV4Number([192, 88, 99, 0]), bits: 24 },
  { base: toV4Number([192, 168, 0, 0]), bits: 16 },
  { base: toV4Number([198, 18, 0, 0]), bits: 15 },
  { base: toV4Number([198, 51, 100, 0]), bits: 24 },
  { base: toV4Number([203, 0, 113, 0]), bits: 24 },
  { base: toV4Number([224, 0, 0, 0]), bits: 4 },
  { base: toV4Number([240, 0, 0, 0]), bits: 4 },
];

interface Cidr6 {
  prefix: number[];
  bits: number;
}

/** Every IPv6 block that is not globally routable. */
const BLOCKED_V6: Cidr6[] = [
  { prefix: [0x00], bits: 8 },
  { prefix: [0xfc], bits: 7 },
  { prefix: [0xfe, 0x80], bits: 10 },
  { prefix: [0xff], bits: 8 },
  { prefix: [0x20, 0x01, 0x0d, 0xb8], bits: 32 },
];

function toV4Number(octets: number[]): number {
  return (
    ((octets[0] ?? 0) << 24) |
    ((octets[1] ?? 0) << 16) |
    ((octets[2] ?? 0) << 8) |
    (octets[3] ?? 0)
  );
}

function parseV4(value: string): number[] | null {
  const parts = value.split('.');
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number.parseInt(part, 10);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets;
}

/** Expand an IPv6 literal to 16 bytes. It accepts an embedded IPv4 tail. */
function parseV6(value: string): number[] | null {
  const zoneless = value.split('%')[0] ?? '';
  if (!zoneless.includes(':')) return null;

  const halves = zoneless.split('::');
  if (halves.length > 2) return null;

  const expand = (part: string): number[] | null => {
    if (part.length === 0) return [];
    const bytes: number[] = [];
    const groups = part.split(':');
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i] ?? '';
      if (i === groups.length - 1 && group.includes('.')) {
        const v4 = parseV4(group);
        if (!v4) return null;
        bytes.push(...v4);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      const word = Number.parseInt(group, 16);
      bytes.push(word >> 8, word & 0xff);
    }
    return bytes;
  };

  const head = expand(halves[0] ?? '');
  if (!head) return null;
  if (halves.length === 1) return head.length === 16 ? head : null;

  const tail = expand(halves[1] ?? '');
  if (!tail) return null;
  const gap = 16 - head.length - tail.length;
  if (gap < 0) return null;
  return [...head, ...new Array<number>(gap).fill(0), ...tail];
}

function isGlobalV4(octets: number[]): boolean {
  const value = toV4Number(octets);
  return !BLOCKED_V4.some(({ base, bits }) => {
    const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

function matchesPrefix(bytes: number[], prefix: number[], bits: number): boolean {
  for (let i = 0; i < prefix.length; i += 1) {
    const remaining = bits - i * 8;
    if (remaining <= 0) break;
    const mask = remaining >= 8 ? 0xff : (0xff << (8 - remaining)) & 0xff;
    if (((bytes[i] ?? 0) & mask) !== ((prefix[i] ?? 0) & mask)) return false;
  }
  return true;
}

function isGlobalV6(bytes: number[]): boolean {
  // An IPv4-mapped address (::ffff:a.b.c.d) reaches the IPv4 network, so it is
  // classified as the IPv4 address it carries.
  const mappedPrefix = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff];
  if (mappedPrefix.every((byte, i) => bytes[i] === byte)) {
    return isGlobalV4(bytes.slice(12));
  }
  if (bytes.every((byte) => byte === 0)) return false;
  if (bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1) return false;
  return !BLOCKED_V6.some(({ prefix, bits }) => matchesPrefix(bytes, prefix, bits));
}

/** True when the literal address is globally routable. An unparsable value is not. */
export function isGlobalAddress(address: string): boolean {
  const v4 = parseV4(address);
  if (v4) return isGlobalV4(v4);
  const v6 = parseV6(address);
  if (v6) return isGlobalV6(v6);
  return false;
}

async function defaultResolveHost(hostname: string): Promise<string[]> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  return records.map((record) => record.address);
}

/**
 * Reject a URL that the platform must not fetch. It allows `http` and `https`
 * only, then resolves the host, because a public name can point at a private
 * address. `ALLOW_PRIVATE_URLS=true` turns the address check off.
 */
export async function assertSafeUrl(
  url: string,
  options: UrlGuardOptions = {},
): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlNotAllowedError(`URL is not parsable: ${url}`);
  }

  if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) {
    throw new UrlNotAllowedError(
      `URL scheme is not allowed: ${parsed.protocol.replace(':', '')}`,
    );
  }

  const allowPrivate = options.allowPrivate ?? process.env.ALLOW_PRIVATE_URLS === 'true';
  if (allowPrivate) return;

  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (hostname.length === 0) {
    throw new UrlNotAllowedError('URL has no host');
  }

  if (parseV4(hostname) || parseV6(hostname)) {
    if (!isGlobalAddress(hostname)) {
      throw new UrlNotAllowedError(`URL points at a non-public address: ${hostname}`);
    }
    return;
  }

  const resolveHost = options.resolveHost ?? defaultResolveHost;
  let addresses: string[];
  try {
    addresses = await resolveHost(hostname);
  } catch {
    throw new UrlNotAllowedError(`URL host does not resolve: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new UrlNotAllowedError(`URL host does not resolve: ${hostname}`);
  }
  for (const address of addresses) {
    if (!isGlobalAddress(address)) {
      throw new UrlNotAllowedError(
        `URL host ${hostname} resolves to a non-public address: ${address}`,
      );
    }
  }
}
