import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { serve } from './server.js';

const root = fileURLToPath(new URL('./example/', import.meta.url));
const verbs = [{ name: 'pin', risk: 'undoable', inputs: [] }, { name: 'delete', risk: 'permanent', inputs: [], after: 'removed' }];
let server;
let opened;
let ran;
let closedTabs;
let openFails = null;

const fakeOpenTab = async options => {
  if (openFails) throw openFails;
  opened.push(options);
  return {
    snapshot: async () => ({ screen: 'Home', url: '/', verbs: [], objects: [{ ref: 'chat:1', in: null, state: [], fields: [], verbs }] }),
    run: async request => {
      ran.push(request);
      return { ok: true };
    },
    goTo: async () => ({ ok: true }),
    close: () => { closedTabs += 1; },
  };
};

before(async () => {
  opened = [];
  ran = [];
  closedTabs = 0;
  server = await serve({ root, files: ['index.html', 'chat.js', 'main.js'], openTab: fakeOpenTab });
});
after(() => server.close());

const base = () => `http://127.0.0.1:${server.port}`;
const person = (path, body, headers = {}) => fetch(`${base()}${path}`, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { 'x-gahi-key': server.key, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const state = async () => (await person('/gahi/state')).json();
const raw = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: server.port, path, method, headers }, res => {
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString() }));
  });
  req.on('error', reject);
  req.end(body);
});
const relink = async () => {
  await person('/gahi/unlink', {});
  await person('/gahi/link', { storage: {} });
  return server.agentUrl();
};

test('there is no agent link until the person makes one', async () => {
  assert.equal(server.agentUrl(), null);
  assert.equal((await state()).link, null);
  assert.equal((await fetch(`${base()}/agent/anything`)).status, 401);
});

test('linking gives the hidden tab the person\'s sign-in, and the agent never sees it', async () => {
  const res = await person('/gahi/link', { storage: { token: 'abc', count: 5 } }, { cookie: 'refresh=xyz; theme=dark' });
  assert.equal(res.status, 200);
  const tab = opened.at(-1);
  assert.equal(tab.url, base());
  assert.deepEqual(tab.cookies, [{ name: 'refresh', value: 'xyz' }, { name: 'theme', value: 'dark' }]);
  assert.deepEqual(tab.storage, { token: 'abc' });
  const link = (await state()).link;
  assert.equal(link, server.agentUrl());
  const text = await (await fetch(link)).text();
  assert.match(text, /^GAHI 0\.1/);
  assert.doesNotMatch(text, /xyz|abc/);
});

test('linking twice keeps the same tab and link', async () => {
  const link = await relink();
  const count = opened.length;
  await person('/gahi/link', { storage: {} });
  assert.equal(opened.length, count);
  assert.equal(server.agentUrl(), link);
});

test('an agent\'s request runs in its tab, and a draft waits for the person', async () => {
  const link = await relink();
  ran.length = 0;
  const pinned = await fetch(link, { method: 'POST', body: JSON.stringify({ verb: 'pin', object: 'chat:1' }) });
  assert.equal(pinned.status, 200);
  assert.deepEqual(ran.map(r => r.verb), ['pin']);
  const drafted = await fetch(link, { method: 'POST', body: JSON.stringify({ verb: 'delete', object: 'chat:1' }) });
  assert.match(await drafted.text(), /In draft/);
  assert.equal(ran.length, 1);
  assert.equal((await state()).draft.length, 1);
  assert.equal((await person('/gahi/approve', {})).status, 200);
  assert.deepEqual(ran.map(r => r.verb), ['pin', 'delete']);
  assert.equal((await state()).draft.length, 0);
});

test('rules set by the person apply to the agent', async () => {
  const link = await relink();
  const rules = (await state()).rules;
  assert.equal((await person('/gahi/rules', { ...rules, verbs: { pin: 'block' } })).status, 200);
  assert.equal((await fetch(link, { method: 'POST', body: JSON.stringify({ verb: 'pin', object: 'chat:1' }) })).status, 403);
  assert.equal((await person('/gahi/rules', { ...rules, verbs: {} })).status, 200);
  for (const bad of [{ risk: { view: 'draft', undoable: 'do', outward: 'do', permanent: 'do' } }, { risk: { ...rules.risk, permanent: 'maybe' } }, { risk: rules.risk, verbs: { pin: 'maybe' } }, {}]) {
    assert.equal((await person('/gahi/rules', bad)).status, 400);
  }
});

test('the agent reads where the person is, and whether they\'re here', async () => {
  const link = await relink();
  await state();
  await person('/gahi/person', { on: 'chat:1', url: '/', screen: 'Home' });
  assert.match(await (await fetch(link)).text(), /^person: on chat:1$/m);
  assert.equal((await person('/gahi/person', { url: '//evil.example' })).status, 200);
  await person('/gahi/person', { on: 'chat:1', url: '/', screen: 'Home' });
});

test('stopping closes the tab, and the old link stops working', async () => {
  const link = await relink();
  const before2 = closedTabs;
  await person('/gahi/unlink', {});
  assert.equal(closedTabs, before2 + 1);
  assert.equal((await fetch(link)).status, 401);
  assert.equal(server.agentUrl(), null);
});

test('with no browser available, linking says so and leaves no link', async () => {
  await person('/gahi/unlink', {});
  openFails = Object.assign(new Error('no Chrome was found'), { status: 503 });
  const res = await person('/gahi/link', { storage: {} });
  openFails = null;
  assert.equal(res.status, 503);
  assert.match(await res.text(), /no Chrome/);
  assert.equal(server.agentUrl(), null);
});

test('an agent gets no route to the person\'s controls', async () => {
  const link = await relink();
  for (const path of ['/gahi/state', '/gahi/read']) assert.equal((await fetch(`${base()}${path}`)).status, 401, path);
  for (const path of ['/gahi/approve', '/gahi/discard', '/gahi/rules', '/gahi/link', '/gahi/unlink', '/gahi/person', '/gahi/act']) {
    assert.equal((await fetch(`${base()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 401, path);
  }
  assert.equal((await person('/gahi/state', undefined, { 'x-gahi-key': 'wrong' })).status, 401);
  assert.equal((await fetch(link, { method: 'POST', body: JSON.stringify({ verb: 'approve' }) })).status, 409);
});

test('agent requests must be valid JSON, and a foreign Origin or Host is refused', async () => {
  const link = await relink();
  const path = new URL(link).pathname;
  assert.equal((await raw(path, { method: 'POST', body: 'verb=pin', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 400);
  const body = JSON.stringify({ verb: 'pin' });
  assert.equal((await raw(path, { method: 'POST', body, headers: { 'content-type': 'application/json', origin: 'https://evil.example' } })).status, 403);
  assert.equal((await raw('/', { headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await raw('/gahi/link', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json', 'x-gahi-key': server.key, origin: 'null' } })).status, 403);
});

test('behind an app\'s own server, it answers only to that app\'s address', async () => {
  const behind = await serve({ port: 0, origin: 'http://127.0.0.1:3001', openTab: fakeOpenTab });
  const ask = (path, headers = {}, method = 'GET', body) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: behind.port, path, method, headers }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const app = { host: '127.0.0.1:3001' };
  assert.match(behind.url, /^http:\/\/127\.0\.0\.1:3001\/#key=/);
  assert.equal((await ask('/gahi/state', { 'x-gahi-key': behind.key })).status, 403);
  assert.equal((await ask('/', app)).status, 404);
  const linked = await ask('/gahi/link', { ...app, 'x-gahi-key': behind.key, 'content-type': 'application/json' }, 'POST', '{"storage":{}}');
  assert.equal(linked.status, 200);
  assert.equal(opened.at(-1).url, 'http://127.0.0.1:3001');
  assert.match(behind.agentUrl(), /^http:\/\/127\.0\.0\.1:3001\/agent\//);
  await behind.close();
});

test('only the listed files are served, with no traversal', async () => {
  assert.equal((await raw('/')).status, 200);
  assert.match((await raw('/')).headers['content-security-policy'], /script-src 'self'/);
  for (const path of ['/gahi/page.js', '/gahi/language.js', '/gahi/session.js', '/chat.js']) assert.equal((await raw(path)).status, 200, path);
  for (const path of ['/gahi/chrome.js', '/gahi/server.js', '/../package.json', '/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/package.json', '/server.js', '//etc/passwd', '/chat.js/../../package.json']) {
    const res = await raw(path);
    assert.ok(res.status === 404 || res.status === 400, `${path} returned ${res.status}`);
    assert.ok(!res.text.includes('"name": "gahi"'));
  }
});
