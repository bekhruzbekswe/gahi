import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { findChrome, openTab } from './chrome.js';

const skip = findChrome() ? false : 'no Chrome on this machine';

const page = `<!doctype html><title>t</title><script>
  window.gahiScreen = {
    snapshot: () => ({ path: location.pathname, token: localStorage.getItem('token'), agentTab: window.__gahiAgentTab === true, focused: document.hasFocus(), width: innerWidth }),
    run: async request => ({ got: request }),
  };
</script>`;

test('the hidden tab is signed in, focused, desktop-sized and closes cleanly', { skip }, async () => {
  const cookies = [];
  const server = http.createServer((req, res) => {
    cookies.push(req.headers.cookie);
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(page);
  });
  await new Promise(done => { server.listen(0, '127.0.0.1', done); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const tab = await openTab({ url, cookies: [{ name: 'session', value: 'abc' }], storage: { token: 'xyz' } });
  try {
    assert.ok(cookies[0].includes('session=abc'));
    const snap = await tab.snapshot();
    assert.equal(snap.token, 'xyz');
    assert.equal(snap.agentTab, true);
    assert.equal(snap.focused, true);
    assert.equal(snap.width, 1280);
    assert.deepEqual(await tab.run({ verb: 'pin', object: 'a:1' }), { got: { verb: 'pin', object: 'a:1' } });
    await tab.goTo('/other');
    assert.equal((await tab.snapshot()).path, '/other');
  } finally {
    tab.close();
    server.closeAllConnections();
    await new Promise(done => { server.close(done); });
  }
  await assert.rejects(tab.snapshot(), e => e.closed === true);
});

test('stopping the server with a signal also stops the hidden tab', { skip }, async () => {
  const { spawn, execSync } = await import('node:child_process');
  const script = `
    import http from 'node:http';
    import { openTab } from ${JSON.stringify(new URL('./chrome.js', import.meta.url).href)};
    const server = http.createServer((q, s) => { s.writeHead(200, { 'content-type': 'text/html' }); s.end('<script>window.gahiScreen = {}</scr' + 'ipt>'); });
    server.listen(0, '127.0.0.1', async () => {
      await openTab({ url: 'http://127.0.0.1:' + server.address().port });
      console.log('ready');
    });
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(done => { child.stdout.once('data', done); });
  const running = () => execSync(`pgrep -P ${child.pid} | wc -l`).toString().trim();
  assert.notEqual(running(), '0');
  const chromes = execSync(`pgrep -P ${child.pid}`).toString().trim().split('\n');
  child.kill('SIGTERM');
  await new Promise(done => { child.once('exit', done); });
  await new Promise(done => { setTimeout(done, 500); });
  for (const pid of chromes) assert.throws(() => process.kill(Number(pid), 0), 'the hidden tab should be gone');
});

test('with no browser, it says so', async () => {
  await assert.rejects(openTab({ url: 'http://127.0.0.1:1', chrome: null }), e => e.status === 503 && /no Chrome/.test(e.message));
});
