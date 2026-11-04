import { mount } from '/gahi/page.js';
import { startChat } from './chat.js';

const send = (path, body) => fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
const store = {
  load: async () => (await fetch('/api/chats')).json(),
  pin: (id, on) => send(`/api/chats/${id}/${on ? 'pin' : 'unpin'}`),
  read: id => send(`/api/chats/${id}/read`),
  reply: (id, text) => send(`/api/chats/${id}/reply`, { text }),
  remove: id => send(`/api/chats/${id}/delete`),
};

startChat(document.getElementById('app'), store, { pollMs: 1000 });
mount();
