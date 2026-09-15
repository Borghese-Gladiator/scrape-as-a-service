import { describe, it, expect } from 'vitest';
import { assertSafeUrl, isGlobalAddress, UrlNotAllowedError } from '../url-guard.js';

/** Resolve every name to one fixed address, so no test touches DNS. */
function resolver(address: string) {
  return async () => [address];
}

const PUBLIC = { resolveHost: resolver('93.184.216.34') };

describe('assertSafeUrl schemes', () => {
  it.each([
    { desc: 'file', url: 'file:///etc/passwd' },
    { desc: 'ftp', url: 'ftp://example.com/x' },
    { desc: 'javascript', url: 'javascript:alert(1)' },
    { desc: 'data', url: 'data:text/html,<h1>x</h1>' },
    { desc: 'gopher', url: 'gopher://example.com/' },
  ])('rejects the $desc scheme', async ({ url }) => {
    await expect(assertSafeUrl(url, PUBLIC)).rejects.toBeInstanceOf(UrlNotAllowedError);
  });

  it.each([
    { desc: 'http', url: 'http://example.com/x' },
    { desc: 'https', url: 'https://example.com/x' },
  ])('allows the $desc scheme', async ({ url }) => {
    await expect(assertSafeUrl(url, PUBLIC)).resolves.toBeUndefined();
  });

  it('rejects an unparsable URL', async () => {
    await expect(assertSafeUrl('not a url', PUBLIC)).rejects.toBeInstanceOf(
      UrlNotAllowedError,
    );
  });
});

describe('assertSafeUrl addresses', () => {
  it.each([
    { desc: 'loopback literal', host: '127.0.0.1' },
    { desc: 'loopback in the range', host: '127.1.2.3' },
    { desc: 'the unspecified address', host: '0.0.0.0' },
    { desc: 'private 10/8', host: '10.1.2.3' },
    { desc: 'private 172.16/12 low', host: '172.16.0.1' },
    { desc: 'private 172.16/12 high', host: '172.31.255.254' },
    { desc: 'private 192.168/16', host: '192.168.1.1' },
    { desc: 'link-local 169.254/16', host: '169.254.169.254' },
    { desc: 'carrier NAT 100.64/10', host: '100.64.0.1' },
    { desc: 'benchmark 198.18/15', host: '198.19.0.1' },
    { desc: 'multicast', host: '224.0.0.1' },
    { desc: 'reserved', host: '255.255.255.255' },
    { desc: 'IPv6 loopback', host: '[::1]' },
    { desc: 'IPv6 unspecified', host: '[::]' },
    { desc: 'IPv6 link-local', host: '[fe80::1]' },
    { desc: 'IPv6 unique-local fc00', host: '[fc00::1]' },
    { desc: 'IPv6 unique-local fd00', host: '[fd12:3456:789a::1]' },
    { desc: 'IPv6 multicast', host: '[ff02::1]' },
    { desc: 'IPv4-mapped private', host: '[::ffff:10.0.0.1]' },
  ])('rejects $desc', async ({ host }) => {
    await expect(assertSafeUrl(`http://${host}/`, PUBLIC)).rejects.toBeInstanceOf(
      UrlNotAllowedError,
    );
  });

  it.each([
    { desc: 'an IPv4 literal', host: '93.184.216.34' },
    { desc: 'an IPv6 literal', host: '[2606:2800:220:1:248:1893:25c8:1946]' },
  ])('allows $desc', async ({ host }) => {
    await expect(assertSafeUrl(`https://${host}/`, PUBLIC)).resolves.toBeUndefined();
  });

  it.each([
    { desc: 'localhost', host: 'localhost', address: '127.0.0.1' },
    {
      desc: 'a name that resolves to a private address',
      host: 'inside.corp',
      address: '10.0.0.5',
    },
    { desc: 'a rebinding name', host: 'evil.test', address: '169.254.169.254' },
    { desc: 'a name that resolves to IPv6 loopback', host: 'db.local', address: '::1' },
  ])('rejects $desc after resolution', async ({ host, address }) => {
    await expect(
      assertSafeUrl(`http://${host}/`, { resolveHost: resolver(address) }),
    ).rejects.toBeInstanceOf(UrlNotAllowedError);
  });

  it('rejects a name whose addresses are mixed', async () => {
    await expect(
      assertSafeUrl('http://mixed.test/', {
        resolveHost: async () => ['93.184.216.34', '127.0.0.1'],
      }),
    ).rejects.toBeInstanceOf(UrlNotAllowedError);
  });

  it('rejects a name that does not resolve', async () => {
    await expect(
      assertSafeUrl('http://nope.invalid/', {
        resolveHost: async () => {
          throw new Error('ENOTFOUND');
        },
      }),
    ).rejects.toBeInstanceOf(UrlNotAllowedError);
  });
});

describe('the bypass flag', () => {
  it('allows a private address when allowPrivate is set', async () => {
    await expect(
      assertSafeUrl('http://127.0.0.1:8080/', { allowPrivate: true }),
    ).resolves.toBeUndefined();
  });

  it('still rejects a non-HTTP scheme when allowPrivate is set', async () => {
    await expect(
      assertSafeUrl('file:///etc/passwd', { allowPrivate: true }),
    ).rejects.toBeInstanceOf(UrlNotAllowedError);
  });
});

describe('isGlobalAddress', () => {
  it.each([
    { address: '8.8.8.8', global: true },
    { address: '172.32.0.1', global: true },
    { address: '172.15.255.255', global: true },
    { address: '2001:4860:4860::8888', global: true },
    { address: '172.16.0.1', global: false },
    { address: '2001:db8::1', global: false },
    { address: 'not-an-address', global: false },
  ])('says $address is global=$global', ({ address, global }) => {
    expect(isGlobalAddress(address)).toBe(global);
  });
});
