import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { GahiError } from './gahi.js';

const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = 1024 * 1024;
const CLIENT = fileURLToPath(new URL('./client.js', import.meta.url));
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const reply = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
};

function readJson(req) {
  return new Promise((resolve, reject) => {
    if (!(req.headers['content-type'] ?? '').startsWith('application/json')) {
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

const rpcResult = (id, result) => ({ jsonrpc: '2.0', id, result });
const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function handleRpc(app, msg) {
  const { id, method, params } = msg;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      return rpcResult(id, {
        protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'gahi', version: '0.1.0' },
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, { tools: app.tools() });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      if (!app.tools().some(t => t.name === name)) return rpcError(id, -32602, 'Unknown tool.');
      if (args === null || typeof args !== 'object' || Array.isArray(args)) return rpcError(id, -32602, 'Arguments must be an object.');
      // The actor is fixed here: nothing an agent sends can make it act as the person.
      return rpcResult(id, app.callTool('agent', name, args));
    }
    default:
      return rpcError(id, -32601, 'Method not found.');
  }
}

const stringList = v => Array.isArray(v) && v.length <= 1000 && v.every(s => typeof s === 'string');

function fail400(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

async function handleHuman(app, path, req) {
  if (path === '/gahi/state' && req.method === 'GET') {
    return {
      draft: app.draft(), timeline: app.timeline(), agentView: app.agentView(),
      viewing: app.viewing(), available: app.available(), actions: app.actionInfo(),
    };
  }
  if (req.method !== 'POST') throw Object.assign(new Error('Not found.'), { status: 404 });
  const body = await readJson(req);
  if (body === null || typeof body !== 'object') fail400('Send a JSON object.');
  switch (path) {
    case '/gahi/approve': {
      const { ids = [], yes = [] } = body;
      if ((ids !== 'all' && !stringList(ids)) || !stringList(yes)) fail400('ids and yes must be lists of ids.');
      return app.approve(ids, { yes, by: 'person' });
    }
    case '/gahi/reject':
      if (!stringList(body.ids)) fail400('ids must be a list of ids.');
      return app.reject(body.ids, { by: 'person' });
    case '/gahi/undo':
      if (typeof body.entry !== 'string') fail400('entry must be an id.');
      return app.undo(body.entry, { by: 'person' });
    case '/gahi/do':
      return app.doAction('person', body.action, body.id, body.input, { yes: body.yes === true });
    case '/gahi/viewing':
      app.setViewing(body.object, body.id);
      return { viewing: app.viewing() };
    default:
      throw Object.assign(new Error('Not found.'), { status: 404 });
  }
}

function sameSecret(given, key) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function serve(app, { page, port = 0 }) {
  const key = randomBytes(24).toString('base64url');
  // An exact list, so a crafted path has nothing to traverse to.
  const files = new Map([
    ['/', [page, 'text/html; charset=utf-8']],
    ['/index.html', [page, 'text/html; charset=utf-8']],
    ['/client.js', [CLIENT, 'text/javascript; charset=utf-8']],
  ]);
  let actualPort = port;

  const server = http.createServer(async (req, res) => {
    try {
      // Checking Host and Origin stops a web page from reaching this local server through the browser.
      const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      const origin = req.headers.origin;
      if (!hosts.includes(req.headers.host) || (origin !== undefined && !hosts.map(h => `http://${h}`).includes(origin))) {
        reply(res, 403, { error: 'This server only accepts requests from itself.' });
        return;
      }
      const { pathname } = new URL(req.url, 'http://localhost');

      if (pathname === '/mcp') {
        if (req.method !== 'POST') {
          reply(res, 405, { error: 'Use POST.' }, { allow: 'POST' });
          return;
        }
        // shortcut: no key on /mcp because it can only read and propose, add auth before binding beyond localhost.
        let msg;
        try {
          msg = await readJson(req);
        } catch (e) {
          if (e.status === 400) reply(res, 400, rpcError(null, -32700, 'Parse error.'));
          else reply(res, e.status ?? 500, { error: e.message });
          return;
        }
        if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
          reply(res, 400, rpcError(msg?.id, -32600, 'Invalid request.'));
          return;
        }
        if (msg.id === undefined) {
          res.writeHead(202).end();
          return;
        }
        reply(res, 200, handleRpc(app, msg));
        return;
      }

      if (pathname.startsWith('/gahi/')) {
        // A local agent can reach this port, so only the holder of the printed key can approve.
        if (!sameSecret(req.headers['x-gahi-key'], key)) {
          reply(res, 401, { error: 'Open the link the server printed. It has the access key.' });
          return;
        }
        try {
          reply(res, 200, await handleHuman(app, pathname, req));
        } catch (e) {
          if (e instanceof GahiError) reply(res, 409, { error: e.message, code: e.code });
          else if (e.status) reply(res, e.status, { error: e.message });
          else throw e;
        }
        return;
      }

      const file = files.get(pathname);
      if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
        reply(res, 404, { error: 'Not found.' });
        return;
      }
      res.writeHead(200, {
        'content-type': file[1], 'content-security-policy': CSP, 'x-content-type-options': 'nosniff',
        'referrer-policy': 'no-referrer', 'cache-control': 'no-store',
      });
      res.end(await readFile(file[0]));
    } catch (e) {
      console.error(e);
      if (!res.headersSent) reply(res, 500, { error: 'Something went wrong on the server.' });
      else res.end();
    }
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => {
      actualPort = server.address().port;
      resolve({
        port: actualPort, key,
        url: `http://127.0.0.1:${actualPort}/#key=${key}`,
        mcpUrl: `http://127.0.0.1:${actualPort}/mcp`,
        close: () => new Promise(done => {
          server.close(done);
          server.closeAllConnections();
        }),
      });
    });
  });
}
