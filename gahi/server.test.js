import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serve } from './server.js';

const root = fileURLToPath(new URL('./example/', import.meta.url));
let server;
let pageRunning = false;

before(async () => {
  server = await serve({ root, files: ['index.html', 'chat.js', 'main.js'], pollMs: 300, waitMs: 400 });
});
after(() => {
  pageRunning = false;
  return server.close();
});

const base = () => `http://127.0.0.1:${server.port}`;
const agentUrl = () => `${base()}/agent/${server.token()}`;
const person = (path, options = {}) => fetch(`${base()}${path}`, { ...options, headers: { 'x-gahi-key': server.key, ...(options.body ? { 'content-type': 'application/json' } : {}) } });

// A fake open page: it answers each job the way the real one would.
async function runPage(answer) {
  pageRunning = true;
  while (pageRunning) {
    const res = await person('/gahi/next');
    if (res.status === 200) {
      const job = await res.json();
      await person('/gahi/answer', { method: 'POST', body: JSON.stringify({ id: job.id, ...answer(job) }) });
    }
  }
}

const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: server.port, path, method, headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  });
  req.on('error', reject);
  req.end(body);
});

test('with no page open, an agent is told so right away', async () => {
  const res = await fetch(agentUrl());
  assert.equal(res.status, 503);
  assert.match(await res.text(), /isn't open/);
});

test('a wrong agent link gets nothing, and the person can stop a linked agent', async () => {
  assert.equal((await fetch(`${base()}/agent/wrong`)).status, 401);
  const old = agentUrl();
  assert.equal((await person('/gahi/unlink', { method: 'POST', body: '{}' })).status, 200);
  assert.equal((await fetch(old)).status, 401);
  const { url } = await (await person('/gahi/link', { method: 'POST', body: '{}' })).json();
  assert.equal(url, agentUrl());
});

test('reads and actions reach the open page, and its answer reaches the agent', async () => {
  const seen = [];
  const page = runPage(job => {
    seen.push(job);
    return job.type === 'read' ? { status: 200, text: 'the screen' } : { status: 403, text: 'blocked' };
  });
  const read = await fetch(agentUrl());
  assert.equal(await read.text(), 'the screen');
  const acted = await fetch(agentUrl(), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ verb: 'pin', object: 'chat:1' }) });
  assert.equal(acted.status, 403);
  assert.equal(await acted.text(), 'blocked');
  assert.deepEqual(seen[1].body, { verb: 'pin', object: 'chat:1' });
  pageRunning = false;
  await page;
});

test('an agent gets no route to the person\'s controls', async () => {
  for (const path of ['/gahi/next', '/gahi/link', '/gahi/unlink', '/gahi/answer']) {
    const res = await fetch(`${base()}${path}`, { method: path === '/gahi/next' ? 'GET' : 'POST', headers: { 'content-type': 'application/json' }, body: path === '/gahi/next' ? undefined : '{}' });
    assert.equal(res.status, 401, path);
  }
});

test('a slow page times out instead of hanging the agent', async () => {
  await person('/gahi/next');
  const res = await fetch(agentUrl());
  assert.equal(res.status, 504);
});

test('agent requests must be valid JSON, and a foreign Origin or Host is refused', async () => {
  const form = await raw(`/agent/${server.token()}`, { method: 'POST', body: 'verb=pin', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(form.status, 400);
  const proposal = JSON.stringify({ verb: 'pin' });
  assert.equal((await raw(`/agent/${server.token()}`, { method: 'POST', body: proposal, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await raw('/', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await raw('/gahi/link', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'x-gahi-key': server.key, origin: 'null' } })).status, 403);
});

test('only the listed files are served, with no traversal', async () => {
  assert.equal((await raw('/')).status, 200);
  assert.match((await raw('/')).headers['content-security-policy'], /script-src 'self'/);
  assert.equal((await raw('/gahi/page.js')).status, 200);
  assert.equal((await raw('/chat.js')).status, 200);
  for (const path of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/gahi/server.js', '/server.js', '//etc/passwd', '/chat.js/../../package.json']) {
    const res = await raw(path);
    assert.ok(res.status === 404 || res.status === 400, `${path} returned ${res.status}`);
    assert.ok(!res.text.includes('"name": "gahi"'));
  }
});
