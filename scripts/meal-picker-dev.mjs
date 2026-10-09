import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdir, readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { setEnvironmentContext } from '@netlify/blobs';
import { SessionTestBlobsServer } from './local-blobs.mjs';
import { api } from '../.netlify/test-runtime.mjs';
const env = parseEnv(await readFile('.dev.vars', 'utf8'));
for (const name of ['API_AUTH_TOKEN', 'GEMINI_API_KEY']) {
  if (!env[name]) throw new Error(`Missing ${name}`);
  process.env[name] = env[name];
}
process.env.GEMINI_MODEL = env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
if (process.argv.includes('--curl-outbound')) {
  const { curlOutbound } = await import('./curl-outbound.mjs');
  const nativeFetch = globalThis.fetch;
  globalThis.fetch = async (r, o) => {
    const req = new Request(r, o);
    if (new URL(req.url).hostname !== 'generativelanguage.googleapis.com') return nativeFetch(r, o);
    const response = await curlOutbound(req);
    return new Response(await response.text(), { status: response.status, headers: { 'content-type': 'application/json' } });
  };
}
await mkdir('.netlify/meal-blobs', { recursive: true });
const blobs = new SessionTestBlobsServer({ directory: '.netlify/meal-blobs', token: 'local-development-storage', logger: () => {} });
const { port } = await blobs.start();
setEnvironmentContext({ siteID: 'local-meal-picker', token: 'local-development-storage', edgeURL: `http://127.0.0.1:${port}`, uncachedEdgeURL: `http://127.0.0.1:${port}` });
const http = createServer(async (incoming, outgoing) => {
  try {
    const request = new Request(`http://localhost:8889${incoming.url}`, {
      method: incoming.method, headers: incoming.headers,
      ...(incoming.method !== 'GET' && incoming.method !== 'HEAD' ? { body: Readable.toWeb(incoming), duplex: 'half' } : {}),
    });
    const response = await api(request);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500, { 'content-type': 'application/json' }); outgoing.end('{"error":"LOCAL_REQUEST_FAILED"}'); }
});
http.listen(8889, '127.0.0.1', () => console.log('Meal picker development API: http://localhost:8889 (real Gemini, local persistent Blobs)'));
async function stop() { http.close(); await blobs.stop(); }
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop().finally(() => process.exit(0)); });
