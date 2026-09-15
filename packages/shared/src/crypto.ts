import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PAYLOAD_VERSION = 'v1';

export class SecretCryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretCryptoError';
  }
}

function decodeKey(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length === KEY_BYTES * 2) {
    return Buffer.from(trimmed, 'hex');
  }
  return Buffer.from(trimmed, 'base64');
}

/**
 * Resolve the key on demand rather than at import. The scheduler never touches
 * a secret, so a process-wide requirement would stop it from starting.
 */
export function loadEncryptionKey(env: NodeJS.ProcessEnv = process.env): Buffer {
  const raw = env.SECRET_ENCRYPTION_KEY;
  if (raw === undefined || raw === '') {
    throw new SecretCryptoError(
      'SECRET_ENCRYPTION_KEY is not set. It must hold 32 bytes as base64 or as hex.',
    );
  }
  const key = decodeKey(raw);
  if (key.length !== KEY_BYTES) {
    throw new SecretCryptoError(
      `SECRET_ENCRYPTION_KEY must decode to ${KEY_BYTES} bytes, got ${key.length}.`,
    );
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  key: Buffer = loadEncryptionKey(),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PAYLOAD_VERSION,
    iv.toString('base64'),
    tag.toString('base64'),
    body.toString('base64'),
  ].join('.');
}

export function decryptSecret(
  payload: string,
  key: Buffer = loadEncryptionKey(),
): string {
  const parts = payload.split('.');
  if (parts.length !== 4 || parts[0] !== PAYLOAD_VERSION) {
    throw new SecretCryptoError('Secret payload is malformed');
  }
  const iv = Buffer.from(parts[1] ?? '', 'base64');
  const tag = Buffer.from(parts[2] ?? '', 'base64');
  const body = Buffer.from(parts[3] ?? '', 'base64');
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretCryptoError('Secret payload is malformed');
  }

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    throw new SecretCryptoError('Secret could not be decrypted');
  }
}
