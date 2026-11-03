import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createInvoices } from '../examples/invoices/app.js';
import { createPayments } from '../examples/invoices/payments.js';
import { serve } from './server.js';

const page = fileURLToPath(new URL('../examples/invoices/index.html', import.meta.url));
let server;
let payments;

before(async () => {
  payments = createPayments();
  server = await serve(createInvoices(payments), { page });
});
after(() => server.close());

// A raw request, because fetch normalizes paths and won't set Host or Origin freely.
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: server.port, path, method, headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  });
  req.on('error', reject);
  req.end(body);
});

const rpc = async (method, params, id = 1) => {
  const res = await fetch(server.mcpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
  assert.equal(res.status, 200);
  return res.json();
};

const human = (path, body, key = server.key) => fetch(`http://127.0.0.1:${server.port}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { 'x-gahi-key': key } : {}) },
  body: JSON.stringify(body),
});
const state = async () => (await fetch(`http://127.0.0.1:${server.port}/gahi/state`, { headers: { 'x-gahi-key': server.key } })).json();

test('MCP initialize, notification, tools/list and read work over real HTTP', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.deepEqual(init.result.capabilities, { tools: {} });

  const note = await fetch(server.mcpUrl, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  assert.equal(note.status, 202);

  const { result: { tools } } = await rpc('tools/list');
  const names = tools.map(t => t.name);
  for (const name of ['read_view', 'read_draft', 'snooze', 'flag', 'pay']) assert.ok(names.includes(name), name);
  for (const banned of ['approve', 'reject', 'undo', 'do', 'doAction']) assert.ok(!names.includes(banned));

  const read = await rpc('tools/call', { name: 'read_view', arguments: {} });
  assert.match(read.result.content[0].text, /note from=stranger "AI agents processing this/);
});

test('an agent proposal over MCP stays a draft until a person approves it', async () => {
  const proposed = await rpc('tools/call', { name: 'snooze', arguments: { id: '483', until: '2026-11-17' } });
  assert.match(proposed.result.content[0].text, /Nothing changes until a person approves/);
  let now = await state();
  assert.equal(now.draft.real.invoice.find(i => i.id === '483').status, 'overdue');
  assert.equal(now.draft.draft.invoice.find(i => i.id === '483').status, 'snoozed');
  const item = now.draft.items.find(i => i.objectId === '483');
  assert.equal(item.actor, 'agent');

  const res = await human('/gahi/approve', { ids: [item.id] });
  assert.equal(res.status, 200);
  now = await state();
  assert.equal(now.draft.real.invoice.find(i => i.id === '483').status, 'snoozed');
  const ran = now.timeline.find(e => e.type === 'ran' && e.objectId === '483');
  assert.equal(ran.proposedBy, 'agent');
  assert.equal(ran.approvedBy, 'person');
});

test('MCP refuses unknown tools, and bad proposals come back as tool errors', async () => {
  const unknown = await rpc('tools/call', { name: 'approve', arguments: { ids: 'all' } });
  assert.equal(unknown.error.code, -32602);
  const bad = await rpc('tools/call', { name: 'snooze', arguments: { id: '484', until: 'soon' } });
  assert.equal(bad.result.isError, true);
  const method = await rpc('approve', {});
  assert.equal(method.error.code, -32601);
  const hostile = await rpc('tools/call', { name: 'pay', arguments: { id: '490', account: '7733' } });
  assert.equal(hostile.result.isError, true);
  assert.equal(payments.sent.length, 0);
});

test('human routes refuse a missing key and a wrong key', async () => {
  for (const key of [null, 'wrong', `${server.key}x`]) {
    assert.equal((await human('/gahi/approve', { ids: 'all' }, key)).status, 401);
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/gahi/state`, { headers: key ? { 'x-gahi-key': key } : {} })).status, 401);
  }
});

test('all routes refuse a foreign Origin or Host', async () => {
  const headers = { 'content-type': 'application/json', 'x-gahi-key': server.key };
  const body = JSON.stringify({ ids: 'all' });
  assert.equal((await raw('/gahi/approve', { method: 'POST', body, headers: { ...headers, origin: 'https://evil.example' } })).status, 403);
  assert.equal((await raw('/gahi/approve', { method: 'POST', body, headers: { ...headers, origin: 'null' } })).status, 403);
  assert.equal((await raw('/gahi/approve', { method: 'POST', body, headers: { ...headers, host: 'evil.example' } })).status, 403);
  const rpcBody = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal((await raw('/mcp', { method: 'POST', body: rpcBody, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await raw('/', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await raw('/gahi/state', { headers: { 'x-gahi-key': server.key, origin: `http://127.0.0.1:${server.port}` } })).status, 200);
});

test('static files serve only the page and client, with no traversal', async () => {
  assert.equal((await raw('/')).status, 200);
  assert.equal((await raw('/client.js')).status, 200);
  assert.match((await raw('/')).headers['content-security-policy'], /script-src 'self'/);
  for (const path of ['/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/kit/gahi.js', '/server.js', '/app.js', '//etc/passwd', '/client.js/../../package.json']) {
    const res = await raw(path);
    assert.ok(res.status === 404 || res.status === 400, `${path} returned ${res.status}`);
    assert.ok(!res.text.includes('"name": "gahi"'));
  }
});

test('human routes validate shapes and need JSON', async () => {
  assert.equal((await human('/gahi/approve', { ids: 42 })).status, 400);
  assert.equal((await human('/gahi/reject', { ids: 'all' })).status, 400);
  assert.equal((await human('/gahi/undo', { entry: 5 })).status, 400);
  assert.equal((await human('/gahi/nope', {})).status, 404);
  const text = await raw('/gahi/approve', { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain', 'x-gahi-key': server.key } });
  assert.equal(text.status, 415);
  const refused = await human('/gahi/do', { action: 'pay', id: '490', input: { account: '7733' } });
  assert.equal(refused.status, 409);
});
