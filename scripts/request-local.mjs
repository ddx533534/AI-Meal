import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Read the local bearer token from disk; never put it in CLI arguments or logs.
const [operation, input] = process.argv.slice(2);
if (!['health', 'history', 'analyze'].includes(operation) || (operation === 'analyze' && !input?.trim())) {
  console.error('Usage: npm run request:local -- health | history | analyze "饮食信息"');
  process.exit(1);
}
const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
if (operation !== 'health' && !secrets.API_AUTH_TOKEN) throw new Error('API_AUTH_TOKEN is not configured.');
const path = operation === 'health' ? '/health' : operation === 'history' ? '/api/records' : '/api/analyze';
const port = process.env.LOCAL_API_PORT ?? '8888';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid LOCAL_API_PORT');
const response = await fetch(`http://127.0.0.1:${port}${path}`, {
  method: operation === 'analyze' ? 'POST' : 'GET',
  headers: {
    ...(operation !== 'health' ? { authorization: `Bearer ${secrets.API_AUTH_TOKEN}` } : {}),
    ...(operation === 'analyze' ? { 'content-type': 'application/json' } : {}),
  },
  body: operation === 'analyze' ? JSON.stringify({ input }) : undefined,
  signal: AbortSignal.timeout(40_000),
});
console.log(JSON.stringify({ httpStatus: response.status, body: await response.json() }, null, 2));
if (!response.ok) process.exitCode = 1;
