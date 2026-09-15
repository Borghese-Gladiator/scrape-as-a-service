#!/usr/bin/env node
// Manual acceptance test for Phase 4.
// It checks a running API for the API key, the secret store, and the SSRF
// guard. It removes every row that it creates.
//
//   API_BASE_URL=http://localhost:4000 API_KEY=... node scripts/manual/phase-4-auth.mjs
//
// The API must run with the same API_KEY and with a SECRET_ENCRYPTION_KEY.

const BASE = (process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
const API_KEY = process.env.API_KEY ?? '';
const SECRET_NAME = `phase4_manual_${Date.now()}`;
const SECRET_VALUE = `plaintext-${Math.random().toString(36).slice(2)}-do-not-leak`;

const problems = [];
const notes = [];

function check(condition, message) {
  if (condition) notes.push(`ok   ${message}`);
  else problems.push(message);
}

async function call(path, init = {}, withKey = true) {
  const headers = { 'Content-Type': 'application/json', ...(init.headers ?? {}) };
  if (withKey && API_KEY.length > 0) headers['X-API-Key'] = API_KEY;
  const res = await fetch(`${BASE}${path}`, { ...init, headers });
  const text = await res.text();
  let body = null;
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, text, body };
}

async function main() {
  if (API_KEY.length === 0) {
    console.error('FAILED: set API_KEY to the key that the running API uses.');
    process.exitCode = 1;
    return;
  }

  const health = await call('/health', {}, false);
  check(
    health.status === 200,
    `GET /health with no key returns 200 (got ${health.status})`,
  );

  const open = await call('/definitions', {}, false);
  check(
    open.status === 401,
    `GET /definitions with no key returns 401 (got ${open.status})`,
  );

  const wrong = await call('/definitions', { headers: { 'X-API-Key': 'wrong' } }, false);
  check(
    wrong.status === 401,
    `GET /definitions with a wrong key returns 401 (got ${wrong.status})`,
  );

  const listed = await call('/definitions');
  check(
    listed.status === 200,
    `GET /definitions with the key returns 200 (got ${listed.status})`,
  );

  let secretId = null;
  try {
    const created = await call('/secrets', {
      method: 'POST',
      body: JSON.stringify({ name: SECRET_NAME, value: SECRET_VALUE }),
    });
    check(created.status === 201, `POST /secrets returns 201 (got ${created.status})`);
    check(
      !created.text.includes(SECRET_VALUE),
      'POST /secrets does not echo the value back',
    );
    check(
      created.body?.ciphertext === undefined,
      'POST /secrets does not return a ciphertext',
    );
    secretId = created.body?.id ?? null;

    const secrets = await call('/secrets');
    check(secrets.status === 200, `GET /secrets returns 200 (got ${secrets.status})`);
    check(!secrets.text.includes(SECRET_VALUE), 'GET /secrets never shows the value');
    check(!secrets.text.includes('ciphertext'), 'GET /secrets never shows a ciphertext');
    check(
      Array.isArray(secrets.body) && secrets.body.some((row) => row.name === SECRET_NAME),
      'GET /secrets lists the new name',
    );

    const blocked = await call('/definitions', {
      method: 'POST',
      body: JSON.stringify({
        name: 'phase-4 ssrf probe',
        url: 'http://169.254.169.254/',
        config: { fields: [{ name: 'a', selector: 'b' }], artifacts: ['JSON'] },
      }),
    });
    check(
      blocked.status === 400,
      `POST /definitions on http://169.254.169.254/ returns 400 (got ${blocked.status})`,
    );

    const fileUrl = await call('/definitions', {
      method: 'POST',
      body: JSON.stringify({
        name: 'phase-4 scheme probe',
        url: 'file:///etc/passwd',
        config: { fields: [{ name: 'a', selector: 'b' }], artifacts: ['JSON'] },
      }),
    });
    check(
      fileUrl.status === 400,
      `POST /definitions on file:///etc/passwd returns 400 (got ${fileUrl.status})`,
    );
  } finally {
    if (secretId) {
      const removed = await call(`/secrets/${secretId}`, { method: 'DELETE' });
      check(
        removed.status === 204,
        `DELETE /secrets/:id returns 204 (got ${removed.status})`,
      );
      const after = await call('/secrets');
      check(
        !after.text.includes(SECRET_NAME),
        'the secret is gone after the delete, so no row is left behind',
      );
    }
  }

  for (const note of notes) console.log(note);
  if (problems.length > 0) {
    console.error('FAILED:');
    for (const problem of problems) console.error(`  ${problem}`);
    process.exitCode = 1;
    return;
  }
  console.log(`OK: ${notes.length} checks passed against ${BASE}`);
}

await main();
