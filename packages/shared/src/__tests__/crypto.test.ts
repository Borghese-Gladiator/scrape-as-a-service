import { randomBytes } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  loadEncryptionKey,
  SecretCryptoError,
} from '../crypto.js';

const KEY = randomBytes(32);
const OTHER_KEY = randomBytes(32);

describe('encryptSecret and decryptSecret', () => {
  it.each([
    { desc: 'a password', plaintext: 'hunter2' },
    { desc: 'a storageState blob', plaintext: JSON.stringify({ cookies: [], origins: [] }) },
    { desc: 'unicode', plaintext: 'pässwörd — 秘密' },
    { desc: 'a long value', plaintext: 'x'.repeat(20_000) },
  ])('round trips $desc', ({ plaintext }) => {
    expect(decryptSecret(encryptSecret(plaintext, KEY), KEY)).toBe(plaintext);
  });

  it('never produces the same ciphertext twice', () => {
    expect(encryptSecret('hunter2', KEY)).not.toBe(encryptSecret('hunter2', KEY));
  });

  it('does not leak the plaintext into the payload', () => {
    expect(encryptSecret('hunter2', KEY)).not.toContain('hunter2');
  });

  it('fails with a wrong key', () => {
    const payload = encryptSecret('hunter2', KEY);
    expect(() => decryptSecret(payload, OTHER_KEY)).toThrow(SecretCryptoError);
  });

  it('fails when the auth tag is tampered with', () => {
    const [version, iv, tag, body] = encryptSecret('hunter2', KEY).split('.');
    const flipped = Buffer.from(tag ?? '', 'base64');
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const payload = [version, iv, flipped.toString('base64'), body].join('.');
    expect(() => decryptSecret(payload, KEY)).toThrow(SecretCryptoError);
  });

  it('fails when the ciphertext is tampered with', () => {
    const [version, iv, tag, body] = encryptSecret('hunter2', KEY).split('.');
    const flipped = Buffer.from(body ?? '', 'base64');
    flipped[0] = (flipped[0]! ^ 0xff) & 0xff;
    const payload = [version, iv, tag, flipped.toString('base64')].join('.');
    expect(() => decryptSecret(payload, KEY)).toThrow(SecretCryptoError);
  });

  it.each([
    { desc: 'too few parts', payload: 'v1.aaa.bbb' },
    { desc: 'a wrong version', payload: `v2.${encryptSecret('x', KEY).split('.').slice(1).join('.')}` },
    { desc: 'a short IV', payload: 'v1.YWJj.YWJjZGVmZ2hpamtsbW5vcA==.YWJj' },
  ])('rejects a malformed payload: $desc', ({ payload }) => {
    expect(() => decryptSecret(payload, KEY)).toThrow(SecretCryptoError);
  });
});

describe('loadEncryptionKey', () => {
  it.each([
    { desc: 'base64', value: KEY.toString('base64') },
    { desc: 'hex', value: KEY.toString('hex') },
  ])('accepts a 32-byte key as $desc', ({ value }) => {
    expect(loadEncryptionKey({ SECRET_ENCRYPTION_KEY: value })).toEqual(KEY);
  });

  it.each([
    { desc: 'unset', env: {} },
    { desc: 'empty', env: { SECRET_ENCRYPTION_KEY: '' } },
    { desc: 'too short', env: { SECRET_ENCRYPTION_KEY: randomBytes(16).toString('base64') } },
    { desc: 'too long', env: { SECRET_ENCRYPTION_KEY: randomBytes(48).toString('hex') } },
  ])('rejects a key that is $desc', ({ env }) => {
    expect(() => loadEncryptionKey(env)).toThrow(SecretCryptoError);
  });
});
