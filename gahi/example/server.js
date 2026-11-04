import { fileURLToPath } from 'node:url';
import { readJson, serve } from '../server.js';
import { memoryStore } from './chat.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const store = memoryStore();

// The app's own backend. GAHI doesn't touch it.
// shortcut: no login, because this is a local demo, and a real app's backend has its own.
async function api(req, res, pathname) {
  if (!pathname.startsWith('/api/chats')) return false;
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  if (pathname === '/api/chats' && req.method === 'GET') {
    reply(200, await store.load());
    return true;
  }
  const match = /^\/api\/chats\/([^/]+)\/(pin|unpin|read|reply|delete)$/.exec(pathname);
  if (!match || req.method !== 'POST') {
    reply(404, {});
    return true;
  }
  const [, id, verb] = match;
  const body = await readJson(req);
  if (verb === 'pin') await store.pin(id, true);
  if (verb === 'unpin') await store.pin(id, false);
  if (verb === 'read') await store.read(id);
  if (verb === 'reply') await store.reply(id, String(body.text ?? ''));
  if (verb === 'delete') await store.remove(id);
  reply(200, {});
  return true;
}

const { url } = await serve({ root, files: ['index.html', 'chat.js', 'main.js'], port: Number(process.env.PORT) || 4310, api });
console.log(`Open the app: ${url}`);
console.log('To connect an agent, click Agent in the corner of the app.');
