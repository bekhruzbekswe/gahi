import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSession } from './session.js';

const pin = { name: 'pin', risk: 'undoable', inputs: [], after: 'pinned=yes' };
const open = { name: 'open', risk: 'view', inputs: [] };
const reply = { name: 'reply', risk: 'outward', inputs: [{ name: 'text', required: true }] };
const remove = { name: 'delete', risk: 'permanent', inputs: [], after: 'removed' };

function fixture({ url = '/', here = () => true, runResult = { ok: true } } = {}) {
  const ran = [];
  const went = [];
  const session = createSession({
    here,
    screen: {
      snapshot: async () => ({
        screen: 'Chats', url, verbs: [{ name: 'search', risk: 'view', inputs: [{ name: 'words', required: true }] }],
        objects: [{ ref: 'chat:1', in: null, state: [], fields: [{ name: 'name', value: 'Mom' }], verbs: [open, pin, reply, remove] }],
      }),
      run: async request => {
        ran.push(request);
        return typeof runResult === 'function' ? runResult(request) : runResult;
      },
      goTo: async address => {
        went.push(address);
        return { ok: true };
      },
    },
  });
  return { session, ran, went };
}

test('a free action runs right away, through the screen', async () => {
  const { session, ran } = fixture();
  const out = await session.act('agent', { verb: 'pin', object: 'chat:1' });
  assert.equal(out.status, 200);
  assert.deepEqual(ran, [{ object: 'chat:1', verb: 'pin', input: {} }]);
  assert.deepEqual(session.log().map(e => e.type), ['ran']);
});

test('a view verb returns the new screen, so the agent saves a read', async () => {
  const { session } = fixture();
  assert.match((await session.act('agent', { verb: 'open', object: 'chat:1' })).text, /Ran open on chat:1\.\n\nGAHI 0\.1/);
  assert.doesNotMatch((await session.act('agent', { verb: 'pin', object: 'chat:1' })).text, /GAHI 0\.1/);
});

test('a permanent action waits on the draft, and only approval runs it', async () => {
  const { session, ran } = fixture();
  const out = await session.act('agent', { verb: 'delete', object: 'chat:1' });
  assert.match(out.text, /In draft: delete on chat:1/);
  assert.equal(ran.length, 0);
  assert.match(await session.read(), /in draft: delete by agent/);
  await session.approve();
  assert.deepEqual(ran.map(r => r.verb), ['delete']);
  assert.equal(session.draft().length, 0);
  assert.deepEqual(session.log().map(e => e.type), ['drafted', 'approved']);
});

test('approving goes back the way the agent reached a verb', async () => {
  const { session, ran } = fixture();
  await session.act('agent', { verb: 'open', object: 'chat:1' });
  await session.act('agent', { verb: 'reply', object: 'chat:1', input: { text: 'Hi' }, draft: true });
  await session.approve();
  assert.deepEqual(ran.at(-1), { object: 'chat:1', verb: 'reply', input: { text: 'Hi' }, via: 'open', reveal: true });
});

test('a failed approval stays on the draft and says why', async () => {
  const { session } = fixture({ runResult: { error: 'It went away.' } });
  await session.act('agent', { verb: 'delete', object: 'chat:1' });
  await session.approve();
  assert.equal(session.draft().length, 1);
  assert.match(session.problem(), /Couldn't run delete on chat:1: It went away\./);
});

test('discard clears the draft, and running the same verb twice keeps one item', async () => {
  const { session, ran } = fixture();
  await session.act('agent', { verb: 'delete', object: 'chat:1' });
  await session.act('agent', { verb: 'delete', object: 'chat:1' });
  assert.equal(session.draft().length, 1);
  await session.discard();
  assert.equal(session.draft().length, 0);
  assert.equal(ran.length, 0);
});

test('rules block a verb, and an agent has no way to approve or change them', async () => {
  const { session, ran } = fixture();
  session.setRules({ ...session.rules(), verbs: { pin: 'block' } });
  assert.equal((await session.act('agent', { verb: 'pin', object: 'chat:1' })).status, 403);
  assert.equal((await session.act('agent', { verb: 'approve' })).status, 409);
  assert.equal((await session.act('agent', { verb: 'pin', object: 'chat:1', rules: {} })).status, 400);
  assert.equal(ran.length, 0);
});

test('bad requests get errors that say how to fix them', async () => {
  const { session } = fixture();
  assert.match((await session.act('agent', { verb: 'pin', target: 'chat:1' })).text, /Unknown field "target"\. Use verb, object, input and draft/);
  assert.match((await session.act('agent', { verb: 'pin' })).text, /pin needs an object, such as \{"verb":"pin","object":"chat:1"\}/);
  assert.equal((await session.act('agent', {})).status, 400);
  assert.equal((await session.act('agent', null)).status, 400);
  assert.equal((await session.act('agent', { verb: 'pin', object: 7 })).status, 400);
  assert.match((await session.act('agent', { verb: 'reply', object: 'chat:1' })).text, /reply needs text/);
  assert.match((await session.act('agent', { verb: 'pin', object: 'chat:1', input: { x: '1' } })).text, /doesn't take "x"/);
  assert.equal((await session.act('agent', { verb: 'reply', object: 'chat:1', input: { text: 5 } })).status, 400);
});

test('an error from the screen reaches the agent and isn\'t logged as done', async () => {
  const { session } = fixture({ runResult: { error: 'The form refused that input.' } });
  const out = await session.act('agent', { verb: 'pin', object: 'chat:1' });
  assert.equal(out.status, 409);
  assert.match(out.text, /refused/);
  assert.deepEqual(session.log(), []);
});

test('when the person is on another screen, the agent can follow them', async () => {
  const { session, went } = fixture({ url: '/' });
  assert.doesNotMatch(await session.read(), /follow-person/);
  session.setPerson({ on: 'memo:9', url: '/m/9', screen: 'Note' });
  const text = await session.read();
  assert.match(text, /person: on memo:9 \(not on your screen\)/);
  assert.match(text, /follow-person\(\) {2}view/);
  assert.match((await session.act('agent', { verb: 'follow-person' })).text, /Ran follow-person/);
  assert.deepEqual(went, ['/m/9']);
});

test('when the person has left, the agent is told and can keep working', async () => {
  const { session, ran } = fixture({ here: () => false });
  session.setPerson({ on: 'chat:1', url: '/other' });
  const text = await session.read();
  assert.match(text, /person: not here right now/);
  assert.doesNotMatch(text, /follow-person/);
  await session.act('agent', { verb: 'pin', object: 'chat:1' });
  assert.equal(ran.length, 1);
});

test('requests run one at a time, in order', async () => {
  const order = [];
  const session = createSession({
    screen: {
      snapshot: async () => ({ screen: 'x', url: '/', verbs: [], objects: [{ ref: 'a:1', in: null, state: [], fields: [], verbs: [pin] }] }),
      run: async request => {
        order.push(`start ${request.object}`);
        await new Promise(r => { setTimeout(r, 10); });
        order.push(`end ${request.object}`);
        return { ok: true };
      },
    },
  });
  await Promise.all([session.act('agent', { verb: 'pin', object: 'a:1' }), session.act('agent', { verb: 'pin', object: 'a:1' })]);
  assert.deepEqual(order, ['start a:1', 'end a:1', 'start a:1', 'end a:1']);
});
