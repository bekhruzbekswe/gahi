// Serves an app's files and connects an agent's link to the person's open page.
// shortcut: one agent link and one open page, upgrade when an app needs several agents or real accounts.
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = fileURLToPath(new URL('.', import.meta.url));
const MAX_BODY = 1024 * 1024;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};
const say = (res, status, text) => {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(text);
};

function readJson(req, { anyType = false } = {}) {
  return new Promise((resolve, reject) => {
    if (!anyType && !(req.headers['content-type'] ?? '').startsWith('application/json')) {
      reject(Object.assign(new Error('Send application/json.'), { status: 415 }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('That request is too large.'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('That isn\'t valid JSON.'), { status: 400 }));
      }
    });
  });
}

function same(given, secret) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function serve({ root, files, port = 0, pollMs = 20000, waitMs = 10000 }) {
  const key = randomBytes(24).toString('base64url');
  const newToken = () => randomBytes(24).toString('base64url');
  let token = newToken();
  // An exact list, so a crafted path has nothing to traverse to.
  const statics = new Map([
    ...files.map(f => [`/${f}`, join(root, f)]),
    ['/', join(root, files[0])],
    ['/gahi/page.js', join(KIT, 'page.js')],
    ['/gahi/language.js', join(KIT, 'language.js')],
  ]);
  const queue = [];
  const waiting = new Map();
  let poller = null;
  let lastSeen = 0;
  let actualPort = port;

  const deliver = () => {
    if (!poller || !queue.length) return;
    const { res, timer } = poller;
    poller = null;
    clearTimeout(timer);
    json(res, 200, queue.shift());
  };

  // The person's open page is what answers an agent, so it's always the real screen.
  const askPage = (type, body) => new Promise(resolve => {
    if (!poller && Date.now() - lastSeen > 3000) {
      resolve({ status: 503, text: 'The app isn\'t open right now. Ask the person to open it.' });
      return;
    }
    const id = randomUUID();
    const timer = setTimeout(() => {
      waiting.delete(id);
      const at = queue.findIndex(job => job.id === id);
      if (at >= 0) queue.splice(at, 1);
      resolve({ status: 504, text: 'The app didn\'t answer. Read the screen before trying again.' });
    }, waitMs);
    waiting.set(id, { resolve, timer });
    queue.push({ id, type, body });
    deliver();
  });

  const server = http.createServer(async (req, res) => {
    try {
      // Checking Host and Origin stops a web page from reaching this local server through the browser.
      const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      const origin = req.headers.origin;
      if (!hosts.includes(req.headers.host) || (origin !== undefined && !hosts.map(h => `http://${h}`).includes(origin))) {
        json(res, 403, { error: 'This server only accepts requests from itself.' });
        return;
      }
      const { pathname } = new URL(req.url, 'http://localhost');

      if (pathname.startsWith('/agent/')) {
        if (!same(pathname.slice('/agent/'.length), token)) {
          say(res, 401, 'This link isn\'t valid. Ask the person for a new one.');
          return;
        }
        if (req.method === 'GET') {
          const { status, text } = await askPage('read');
          say(res, status, text);
        } else if (req.method === 'POST') {
          // The secret link and the Origin check guard this route, so a forgotten header needn't cost an agent a try.
          const body = await readJson(req, { anyType: true });
          const { status, text } = await askPage('act', body);
          say(res, status, text);
        } else say(res, 405, 'Use GET to read and POST to act.');
        return;
      }

      if (['/gahi/next', '/gahi/answer', '/gahi/link', '/gahi/unlink'].includes(pathname)) {
        // A local agent can reach this port, so only the printed key can stand in for the person.
        if (!same(req.headers['x-gahi-key'], key)) {
          json(res, 401, { error: 'Open the link the server printed. It has the access key.' });
          return;
        }
        lastSeen = Date.now();
        if (pathname === '/gahi/next' && req.method === 'GET') {
          if (poller) {
            clearTimeout(poller.timer);
            poller.res.writeHead(204).end();
          }
          const entry = {
            res,
            timer: setTimeout(() => {
              if (poller !== entry) return;
              poller = null;
              res.writeHead(204).end();
            }, pollMs),
          };
          poller = entry;
          res.on('close', () => {
            if (poller === entry) {
              clearTimeout(entry.timer);
              poller = null;
            }
          });
          deliver();
          return;
        }
        if (req.method !== 'POST') {
          json(res, 405, { error: 'Use POST.' });
          return;
        }
        const body = await readJson(req);
        if (pathname === '/gahi/answer') {
          const entry = waiting.get(body?.id);
          if (entry) {
            waiting.delete(body.id);
            clearTimeout(entry.timer);
            entry.resolve({ status: [200, 400, 403, 409].includes(body.status) ? body.status : 500, text: String(body.text ?? '') });
          }
          json(res, 200, {});
        } else if (pathname === '/gahi/link') {
          json(res, 200, { url: `http://127.0.0.1:${actualPort}/agent/${token}` });
        } else {
          // A new token makes the old link stop working.
          token = newToken();
          json(res, 200, {});
        }
        return;
      }

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
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong on the server.' });
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      actualPort = server.address().port;
      resolve({
        port: actualPort, key,
        token: () => token,
        url: `http://127.0.0.1:${actualPort}/#key=${key}`,
        close: () => new Promise(done => {
          server.close(done);
          server.closeAllConnections();
        }),
      });
    });
  });
}
