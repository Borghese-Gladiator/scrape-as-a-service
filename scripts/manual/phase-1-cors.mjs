#!/usr/bin/env node
const baseUrl = (process.argv[2] ?? 'http://localhost:4000').replace(/\/$/, '');
const origin = process.env.ORIGIN ?? 'http://localhost:3000';

const CORS_HEADERS = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-max-age',
  'vary',
];

function printCorsHeaders(res) {
  for (const name of CORS_HEADERS) {
    const value = res.headers.get(name);
    if (value !== null) console.log(`  ${name}: ${value}`);
  }
}

async function preflight() {
  console.log(`preflight OPTIONS ${baseUrl}/definitions from ${origin}`);
  const res = await fetch(`${baseUrl}/definitions`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  console.log(`  status: ${res.status}`);
  printCorsHeaders(res);
  return res.headers.get('access-control-allow-origin') === origin;
}

async function create() {
  console.log(`POST ${baseUrl}/definitions from ${origin}`);
  const res = await fetch(`${baseUrl}/definitions`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: `cors-check-${Date.now()}`,
      url: 'https://example.com',
      config: {
        fields: [{ name: 'title', selector: 'h1' }],
        artifacts: ['JSON'],
      },
    }),
  });
  console.log(`  status: ${res.status}`);
  printCorsHeaders(res);
  console.log(`  body: ${await res.text()}`);
  return res.status === 201;
}

const allowed = await preflight();
const created = await create();

if (allowed && created) {
  console.log('PASS: the API allows the origin and accepted the write.');
  process.exit(0);
}

console.error('FAIL: check CORS_ORIGINS on the api service.');
process.exit(1);
