import { fileURLToPath } from 'node:url';
import { serve } from '../../kit/server.js';
import { createInvoices } from './app.js';
import { createPayments } from './payments.js';

const page = fileURLToPath(new URL('./index.html', import.meta.url));
const { url, mcpUrl } = await serve(createInvoices(createPayments()), { page, port: 4310 });
console.log(`Open the app: ${url}`);
console.log(`Agents connect to MCP at: ${mcpUrl}`);
