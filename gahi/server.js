// Serves an app's files, holds the rules and drafts, and connects an agent's link to its own hidden tab.
// shortcut: one agent, and rules and drafts live in memory, upgrade when an app needs several agents or restarts safely.
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openTab as openChromeTab } from './chrome.js';
import { LEVELS } from './language.js';
import { createSession } from './session.js';

const KIT = fileURLToPath(new URL('.', import.meta.url));
const MAX_BODY = 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const OUTCOMES = ['do', 'draft', 'block'];
const PERSON_ROUTES = ['/gahi/state', '/gahi/read', '/gahi/act', '/gahi/rules', '/gahi/person', '/gahi/link', '/gahi/unlink', '/gahi/approve', '/gahi/discard'];

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const say = (res, status, text) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
};
const refuse = (status, message) => Object.assign(new Error(message), { status });

export function readJson(req, { anyType = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!anyType && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
      reject(refuse(415, 'Send application/json.'));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(refuse(413, 'That request is too large.'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(refuse(400, 'That isn\'t valid JSON.'));
      }
    });
  });
}

function same(given, secret) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function cleanRules(body) {
  const risk = {};
  for (const level of LEVELS) {
    const rule = body?.risk?.[level];
    if (!OUTCOMES.includes(rule) || (level === 'view' && rule === 'draft')) throw refuse(400, `The rule for ${level} isn't valid.`);
    risk[level] = rule;
  }
  const verbs = {};
  for (const [name, rule] of Object.entries(body?.verbs ?? {})) {
    if (!OUTCOMES.includes(rule)) throw refuse(400, `The rule for ${name} isn't valid.`);
    verbs[name] = rule;
  }
  return { draftAll: body?.draftAll === true, risk, verbs };
}

function cleanPerson(body) {
  const text = v => (typeof v === 'string' ? v.slice(0, 300) : null);
  const url = text(body?.url);
  const within = Array.isArray(body?.within) ? body.within.filter(v => typeof v === 'string').slice(0, 10) : [];
  return { on: text(body?.on), within, pointing: text(body?.pointing), screen: text(body?.screen), url: url?.startsWith('/') && !url.startsWith('//') ? url : null };
}

function cleanStorage(body) {
  return Object.fromEntries(Object.entries(body?.storage ?? {}).filter(([, v]) => typeof v === 'string'));
}

const parseCookies = header => (header ?? '').split(';').map(part => part.trim()).filter(Boolean).map(part => {
  const at = part.indexOf('=');
  return at < 0 ? { name: part, value: '' } : { name: part.slice(0, at), value: part.slice(at + 1) };
});

export function serve({ root, files = [], port = 0, origin, api, openTab = openChromeTab }) {
  const key = randomBytes(24).toString('base64url');
  // An exact list, so a crafted path has nothing to traverse to.
  const statics = new Map([
    ...files.map(f => [`/${f}`, join(root, f)]),
    ...(files.length ? [['/', join(root, files[0])]] : []),
    ['/gahi/page.js', join(KIT, 'page.js')],
    ['/gahi/language.js', join(KIT, 'language.js')],
    ['/gahi/session.js', join(KIT, 'session.js')],
  ]);
  let actualPort = port;
  let token = null;
  let seed = null;
  let tab = null;
  let lastSeen = 0;
  const base = () => origin ?? `http://127.0.0.1:${actualPort}`;

  const openAgentTab = () => {
    tab = openTab({ url: base(), ...seed }).catch(e => {
      tab = null;
      throw e;
    });
    return tab;
  };
  const withTab = async use => {
    if (!seed) throw refuse(409, 'No agent is linked. Ask the person for a new link.');
    try {
      return await use(await (tab ?? openAgentTab()));
    } catch (e) {
      if (!e.closed) throw e;
      // Chrome can crash or be quit, and the person's sign-in is still good.
      return use(await openAgentTab());
    }
  };
  const session = createSession({
    screen: {
      snapshot: () => withTab(t => t.snapshot()),
      run: request => withTab(t => t.run(request)),
      goTo: address => withTab(t => t.goTo(address)),
    },
    here: () => Date.now() - lastSeen < 5000,
  });

  async function stopAgent() {
    token = null;
    seed = null;
    const closing = tab;
    tab = null;
    if (closing) (await closing.catch(() => null))?.close();
  }

  async function handlePerson(pathname, req, res) {
    if (pathname === '/gahi/state' && req.method === 'GET') {
      lastSeen = Date.now();
      json(res, 200, {
        rules: session.rules(), draft: session.draft(), log: session.log(), problem: session.problem(), person: session.person(),
        link: token ? `${base()}/agent/${token}` : null,
      });
      return;
    }
    if (pathname === '/gahi/read' && req.method === 'GET') {
      say(res, 200, await session.read('page'));
      return;
    }
    if (req.method !== 'POST') throw refuse(405, 'Use POST.');
    const body = await readJson(req);
    switch (pathname) {
      case '/gahi/act': {
        const { status, text } = await session.act('agent', body, 'page');
        say(res, status, text);
        return;
      }
      case '/gahi/rules':
        session.setRules(cleanRules(body));
        break;
      case '/gahi/person':
        session.setPerson(cleanPerson(body));
        break;
      case '/gahi/link':
        if (!token) {
          // The agent never sees these. They only sign in its hidden tab.
          seed = { cookies: parseCookies(req.headers.cookie), storage: cleanStorage(body) };
          await openAgentTab();
          token = randomBytes(24).toString('base64url');
        }
        break;
      case '/gahi/unlink':
        await stopAgent();
        break;
      case '/gahi/approve':
        await session.approve();
        break;
      case '/gahi/discard':
        await session.discard();
        break;
      default:
        throw refuse(404, 'Not found.');
    }
    json(res, 200, {});
  }

  const server = http.createServer(async (req, res) => {
    try {
      // Checking Host and Origin stops a web page from reaching this local server through the browser.
      // With an origin, this sits behind the app's own server, which forwards its Host unchanged.
      const hosts = origin ? [new URL(origin).host] : [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      const from = req.headers.origin;
      if (!hosts.includes(req.headers.host) || (from !== undefined && !hosts.map(h => `http://${h}`).includes(from))) {
        json(res, 403, { error: 'This server only accepts requests from itself.' });
        return;
      }
      const { pathname } = new URL(req.url, 'http://localhost');

      if (pathname.startsWith('/agent/')) {
        if (!token || !same(pathname.slice('/agent/'.length), token)) {
          say(res, 401, 'This link isn\'t valid. Ask the person for a new one.');
          return;
        }
        if (req.method === 'GET') {
          say(res, 200, await session.read('link'));
        } else if (req.method === 'POST') {
          // The secret link and the Origin check guard this route, so a forgotten header needn't cost an agent a try.
          const { status, text } = await session.act('agent', await readJson(req, { anyType: true }));
          say(res, status, text);
        } else say(res, 405, 'Use GET to read and POST to act.');
        return;
      }

      if (PERSON_ROUTES.includes(pathname)) {
        // A local agent can reach this port, so only the printed key can stand in for the person.
        if (!same(req.headers['x-gahi-key'], key)) {
          json(res, 401, { error: 'Open the link the server printed. It has the access key.' });
          return;
        }
        await handlePerson(pathname, req, res);
        return;
      }

      if (api && await api(req, res, pathname)) return;

      const file = statics.get(pathname);
      if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
        json(res, 404, { error: 'Not found.' });
        return;
      }
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
      });
      res.end(await readFile(file));
    } catch (e) {
      if (e.status) {
        say(res, e.status, e.message);
        return;
      }
      console.error(e);
      if (!res.headersSent) say(res, 500, `Something went wrong: ${e.message}`);
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      actualPort = server.address().port;
      resolve({
        port: actualPort, key,
        url: `${base()}/#key=${key}`,
        agentUrl: () => (token ? `${base()}/agent/${token}` : null),
        close: async () => {
          await stopAgent();
          await new Promise(done => {
            server.close(done);
            server.closeAllConnections();
          });
        },
      });
    });
  });
}
