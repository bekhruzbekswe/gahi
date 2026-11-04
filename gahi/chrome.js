// The agent's own hidden tab. It's driven over a pipe rather than a debugging port,
// so nothing else on this machine can connect to it and borrow the person's sign-in.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PLACES = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'],
  win32: ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'],
};

export const findChrome = () => process.env.GAHI_CHROME ?? (PLACES[process.platform] ?? []).find(path => existsSync(path));

const pause = ms => new Promise(resolve => { setTimeout(resolve, ms); });

export async function openTab({ url, cookies = [], storage = {}, chrome = findChrome(), waitMs = 20000 }) {
  if (!chrome) throw Object.assign(new Error('An agent needs its own browser tab, and no Chrome was found on this machine.'), { status: 503 });
  const profile = mkdtempSync(join(tmpdir(), 'gahi-agent-'));
  const child = spawn(chrome, ['--headless=new', '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'], {
    stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'],
  });
  let closed = false;
  let pressEscape = () => {};
  const cleanUp = () => {
    closed = true;
    child.kill();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  };
  // Ctrl+C and kill skip the exit event, and this tab holds the person's sign-in, so it must never outlive the server.
  const onSignal = signal => {
    cleanUp();
    process.exit(signal === 'SIGINT' ? 130 : 143);
  };
  process.on('exit', cleanUp);
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  const pending = new Map();
  let nextId = 0;
  let buffer = '';

  const failAll = error => {
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
  };
  child.on('error', e => failAll(e));
  child.on('exit', () => {
    closed = true;
    failAll(Object.assign(new Error('The agent\'s tab closed.'), { closed: true }));
  });
  child.stdio[4].on('data', chunk => {
    buffer += chunk.toString('utf8');
    let end;
    while ((end = buffer.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__gahiEscape') pressEscape();
      const waiter = pending.get(msg.id);
      if (!waiter) continue;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message));
      else waiter.resolve(msg.result);
    }
  });

  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (closed) {
      reject(Object.assign(new Error('The agent\'s tab closed.'), { closed: true }));
      return;
    }
    nextId += 1;
    pending.set(nextId, { resolve, reject });
    child.stdio[3].write(`${JSON.stringify({ id: nextId, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
  });

  // A private context keeps the person's sign-in in memory and off the disk.
  const { browserContextId } = await send('Target.createBrowserContext');
  const { targetId } = await send('Target.createTarget', { url: 'about:blank', browserContextId });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  const tab = (method, params) => send(method, params, sessionId);
  // Some dialogs ignore a key sent from page code, so the page asks for a real one.
  pressEscape = () => {
    for (const type of ['keyDown', 'keyUp']) tab('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
  };

  const evaluate = async expression => {
    const { result, exceptionDetails } = await tab('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  };
  const ready = async () => {
    const until = Date.now() + waitMs;
    while (Date.now() < until) {
      if (await evaluate('Boolean(window.gahiScreen)').catch(() => false)) return;
      await pause(100);
    }
    throw new Error('The app didn\'t load in the agent\'s tab.');
  };
  const goTo = async address => {
    await tab('Page.navigate', { url: new URL(address, url).href });
    await pause(50);
    await ready();
    // The kit loads before the app has fetched its data, and an agent shouldn't read an empty screen.
    await evaluate('window.gahiScreen.settled?.()');
  };

  await tab('Page.enable');
  await tab('Network.enable');
  await tab('Runtime.enable');
  await tab('Runtime.addBinding', { name: '__gahiEscape' });
  if (cookies.length) await tab('Network.setCookies', { cookies: cookies.map(c => ({ ...c, url })) });
  // A desktop size so desktop-only controls exist, and steady focus so rich editors take text in the background.
  await tab('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await tab('Emulation.setFocusEmulationEnabled', { enabled: true });
  await tab('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__gahiAgentTab = true;
      try {
        if (!localStorage.getItem('gahi-seeded')) {
          for (const [k, v] of Object.entries(${JSON.stringify(storage)})) localStorage.setItem(k, v);
          localStorage.setItem('gahi-seeded', '1');
        }
      } catch {}`,
  });
  await goTo(url);

  return {
    snapshot: () => evaluate('window.gahiScreen.snapshot()'),
    run: request => evaluate(`window.gahiScreen.run(${JSON.stringify(request)})`),
    goTo: async address => {
      await goTo(address);
      return { ok: true };
    },
    evaluate,
    close: () => {
      process.off('exit', cleanUp);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      cleanUp();
      failAll(Object.assign(new Error('The agent\'s tab closed.'), { closed: true }));
    },
  };
}
