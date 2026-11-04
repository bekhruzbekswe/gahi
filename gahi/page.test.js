// Runs the real page code in a real browser, so it needs Chrome.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import { after, before, test } from 'node:test';
import { findChrome, openTab } from './chrome.js';

const skip = findChrome() ? false : 'no Chrome on this machine';
const kit = name => readFileSync(new URL(name, import.meta.url));

// A small app built the awkward way real apps are: a menu and a dialog that only exist while open,
// drawn at the end of the page rather than inside their object, and a rich editor with no form.
const app = `<!doctype html><title>Notes</title><body gahi-screen="Notes">
<article id="note" gahi-object="note:1" gahi-state="pinned=no">
  <div gahi-field="text"><p>Buy milk</p><p>And eggs</p></div>
  <button id="more" gahi-menu>More</button>
</article>
<button id="find" gahi-menu>Find</button>
<div id="composer">
  <div id="editor" contenteditable="true" gahi-input="content"></div>
  <button id="save" disabled gahi-verb="create" gahi-risk="undoable" gahi-uses="content">Save</button>
</div>
<ul id="created"></ul>
<script type="module">
  import { mount } from '/page.js';
  window.opens = 0;
  let pinned = false;
  const article = document.getElementById('note');
  const closeMenu = () => document.getElementById('portal')?.remove();
  const item = (verb, risk, label, onclick) => {
    const b = document.createElement('button');
    b.setAttribute('gahi-verb', verb);
    b.setAttribute('gahi-risk', risk);
    b.textContent = label;
    b.onclick = () => { closeMenu(); onclick(); };
    return b;
  };
  document.getElementById('more').onclick = () => {
    if (document.getElementById('portal')) return closeMenu();
    window.opens += 1;
    const portal = document.createElement('div');
    portal.id = 'portal';
    portal.append(
      pinned
        ? item('unpin', 'undoable', 'Unpin', () => { pinned = false; article.setAttribute('gahi-state', 'pinned=no'); })
        : item('pin', 'undoable', 'Pin', () => { pinned = true; article.setAttribute('gahi-state', 'pinned=yes'); }),
      item('delete', 'permanent', 'Delete', () => {
        const dialog = document.createElement('div');
        dialog.id = 'dialog';
        const yes = document.createElement('button');
        yes.setAttribute('gahi-confirm', '');
        yes.textContent = 'Yes, delete';
        yes.onclick = () => { dialog.remove(); article.remove(); };
        dialog.append(yes);
        document.body.append(dialog);
      }),
    );
    document.body.append(portal);
  };
  // Like some real dialogs, this one only closes for a real key press.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeMenu();
    if (e.key === 'Escape' && e.isTrusted) document.getElementById('finder')?.remove();
  });
  document.getElementById('find').onclick = () => {
    if (document.getElementById('finder')) return;
    const finder = document.createElement('div');
    finder.id = 'finder';
    const words = document.createElement('input');
    words.setAttribute('gahi-input', 'words');
    const go = document.createElement('button');
    go.setAttribute('gahi-verb', 'search');
    go.setAttribute('gahi-risk', 'view');
    go.setAttribute('gahi-uses', 'words');
    go.onclick = () => {
      document.title = 'Found ' + words.value;
      finder.remove();
    };
    const tag = document.createElement('div');
    tag.setAttribute('gahi-object', 'tag:1');
    tag.setAttribute('gahi-verb', 'filter');
    tag.setAttribute('gahi-risk', 'view');
    finder.append(words, go, tag);
    document.body.append(finder);
  };
  const editor = document.getElementById('editor');
  const save = document.getElementById('save');
  const sync = () => { save.disabled = !editor.innerText.trim(); };
  editor.addEventListener('input', sync);
  editor.addEventListener('paste', e => {
    e.preventDefault();
    editor.innerText = e.clipboardData.getData('text/plain');
    sync();
  });
  save.onclick = () => {
    const li = document.createElement('li');
    li.textContent = editor.innerText;
    document.getElementById('created').append(li);
    editor.innerText = '';
    sync();
  };
  mount();
</script>`;

let server;
let tab;

before(async () => {
  if (skip) return;
  server = http.createServer((req, res) => {
    const files = { '/page.js': 'page.js', '/language.js': 'language.js', '/session.js': 'session.js' };
    if (files[req.url]) {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(kit(files[req.url]));
    } else {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(app);
    }
  });
  await new Promise(done => { server.listen(0, '127.0.0.1', done); });
  tab = await openTab({ url: `http://127.0.0.1:${server.address().port}` });
});

after(async () => {
  if (skip) return;
  tab.close();
  server.closeAllConnections();
  await new Promise(done => { server.close(done); });
});

const note = async () => (await tab.snapshot()).objects.find(o => o.ref === 'note:1');
const opens = () => tab.evaluate('window.opens');
const menuOpen = () => tab.evaluate('Boolean(document.getElementById("portal"))');

test('the agent\'s tab sees verbs inside a menu, and leaves the menu closed', { skip }, async () => {
  const obj = await note();
  assert.deepEqual(obj.verbs.map(v => v.name), ['pin', 'delete']);
  assert.equal(obj.verbs.find(v => v.name === 'delete').risk, 'permanent');
  assert.equal(await menuOpen(), false);
  assert.equal((await tab.snapshot()).verbs.some(v => v.name === 'pin'), false, 'a menu verb stays with its object');
});

test('a field keeps its line breaks, on one JSON-encoded line', { skip }, async () => {
  assert.equal((await note()).fields[0].value.replace(/\n+/g, '\n'), 'Buy milk\nAnd eggs');
});

test('a dialog on the screen is read too, closed with a real key, and its parts stay separate', { skip }, async () => {
  const snap = await tab.snapshot();
  assert.equal(snap.verbs.find(v => v.name === 'search').inputs[0].name, 'words');
  assert.equal(snap.verbs.some(v => v.name === 'filter'), false, 'a verb on an object inside the dialog isn\'t the dialog\'s');
  assert.equal(await tab.evaluate('Boolean(document.getElementById("finder"))'), false);
  assert.deepEqual(await tab.run({ verb: 'search', input: { words: 'milk' } }), { ok: true });
  assert.equal(await tab.evaluate('document.title'), 'Found milk');
  assert.equal(await tab.evaluate('Boolean(document.getElementById("finder"))'), false);
});

test('a menu only opens again when its object changes', { skip }, async () => {
  const before2 = await opens();
  await note();
  await note();
  assert.equal(await opens(), before2);
});

test('running a menu verb opens the real menu and presses the real item', { skip }, async () => {
  assert.deepEqual(await tab.run({ object: 'note:1', verb: 'pin' }), { ok: true });
  assert.equal(await menuOpen(), false);
  const obj = await note();
  assert.deepEqual(obj.state, [['pinned', 'yes']]);
  assert.deepEqual(obj.verbs.map(v => v.name), ['unpin', 'delete'], 'the menu is read again after the object changes');
  await tab.run({ object: 'note:1', verb: 'unpin' });
});

test('a verb that isn\'t in the menu is refused, and the menu closes again', { skip }, async () => {
  const out = await tab.run({ object: 'note:1', verb: 'fly' });
  assert.match(out.error, /no verb "fly"/);
  assert.equal(await menuOpen(), false);
});

test('a rich editor outside a form takes one line and several, and its disabled button works', { skip }, async () => {
  assert.equal((await tab.snapshot()).verbs.find(v => v.name === 'create').inputs[0].name, 'content');
  assert.deepEqual(await tab.run({ verb: 'create', input: { content: 'One line' } }), { ok: true });
  assert.deepEqual(await tab.run({ verb: 'create', input: { content: 'First\nSecond' } }), { ok: true });
  assert.deepEqual(await tab.evaluate('[...document.querySelectorAll("#created li")].map(li => li.textContent)'), ['One line', 'First\nSecond']);
});

test('an app\'s own confirm dialog gets the real yes', { skip }, async () => {
  assert.deepEqual(await tab.run({ object: 'note:1', verb: 'delete' }), { ok: true });
  assert.equal(await tab.evaluate('Boolean(document.getElementById("dialog"))'), false);
  assert.equal(await note(), undefined);
});
