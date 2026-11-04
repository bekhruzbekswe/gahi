import { fileURLToPath } from 'node:url';
import { serve } from '../server.js';

const root = fileURLToPath(new URL('.', import.meta.url));
const { url } = await serve({ root, files: ['index.html', 'chat.js', 'main.js'], port: 4310 });
console.log(`Open the app: ${url}`);
console.log('To connect an agent, click Agent in the corner of the app.');
