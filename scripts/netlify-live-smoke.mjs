import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { api } from '../.netlify/test-runtime.mjs';

const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
for (const key of ['GEMINI_API_KEY', 'API_AUTH_TOKEN']) {
  if (!secrets[key]?.trim()) throw new Error(`${key} is missing in .dev.vars`);
  process.env[key] = secrets[key];
}
process.env.GEMINI_MODEL ||= 'gemini-3.1-flash-lite';
const nativeFetch = globalThis.fetch;
const curlTransport = process.argv.includes('--curl-outbound');
const { curlOutbound } = curlTransport ? await import('./curl-outbound.mjs') : {};
globalThis.fetch = async (request, options) => {
  const req = new Request(request, options);
  if (new URL(req.url).hostname !== 'generativelanguage.googleapis.com') return nativeFetch(request, options);
  try {
    const response = curlTransport
      ? await curlOutbound(req).then(async res => new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } }))
      : await nativeFetch(request, options);
    const data = await response.clone().json();
    console.log(JSON.stringify({ transport: curlTransport ? 'curl diagnostic' : 'native Node fetch', httpStatus: response.status, providerStatus: data.error?.status, candidateCount: data.candidates?.length ?? 0, finishReason: data.candidates?.[0]?.finishReason }));
    return response;
  } catch (error) {
    console.log(JSON.stringify({ transport: 'native Node fetch', errorType: error.name, networkCode: error.cause?.code }));
    throw error;
  }
};
const directory = await mkdtemp(join(tmpdir(), 'ai-meal-netlify-live-'));
const server = new BlobsServer({ directory, token: 'local-live-blobs-token', logger: () => {} });
const result = { verifiedAt: new Date().toISOString(), runtime: `Node ${process.version}`, modelCall: 'real Gemini API (no mock)', storage: 'real Blobs SDK with local temporary server', cloudDeployment: 'not tested' };
try {
  const { port } = await server.start();
  setEnvironmentContext({ siteID: 'local-live-site', token: 'local-live-blobs-token', edgeURL: `http://127.0.0.1:${port}`, uncachedEdgeURL: `http://127.0.0.1:${port}` });
  const input = '早餐吃了一个鸡蛋和一片面包，重量和配料未知。请只整理已知信息，并指出缺失信息。';
  const response = await api(new Request('http://localhost/api/analyze', {
    method: 'POST', headers: { authorization: `Bearer ${secrets.API_AUTH_TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify({ input }),
  }));
  result.httpStatus = response.status;
  const payload = await response.json();
  if (response.status !== 201) {
    result.error = payload.error;
    result.reason = payload.reason;
    throw new Error('Live API failed');
  }
  assert.ok(payload.record.output?.trim());
  const history = await api(new Request('http://localhost/api/records', { headers: { authorization: `Bearer ${secrets.API_AUTH_TOKEN}` } }));
  assert.deepEqual((await history.json()).records, [payload.record]);
  result.status = 'passed';
  result.blobsRoundTrip = 'passed';
  result.durationMs = payload.record.duration_ms;
  result.record = payload.record;
} catch (error) {
  result.status = 'failed';
  result.failureType = error.name;
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  await server.stop();
  await rm(directory, { recursive: true, force: true });
  await mkdir('verification', { recursive: true });
  await writeFile(curlTransport ? 'verification/netlify-live-smoke-curl.local.json' : 'verification/netlify-live-smoke.local.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
