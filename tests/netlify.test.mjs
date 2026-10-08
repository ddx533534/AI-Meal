import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { setEnvironmentContext } from '@netlify/blobs';
import { BlobsServer } from '@netlify/blobs/server';
import { api, config, createRecordStore } from '../.netlify/test-runtime.mjs';

const originalFetch = globalThis.fetch;
const token = 'netlify-test-token';
const input = '早餐吃了一个鸡蛋，重量未知。';
const output = '早餐包含一个鸡蛋，重量未知。';
let server;
let directory;
let blobsURL;
let mode = 'success';
let modelCalls = 0;

function call(path, { method = 'GET', body, authorized = true, contentType = 'application/json', raw } = {}) {
  return api(new Request(`http://localhost${path}`, {
    method,
    headers: {
      ...(authorized ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined || raw !== undefined ? { 'content-type': contentType } : {}),
    },
    body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  }));
}

async function startBlobs() {
  server = new BlobsServer({ directory, token: 'local-blobs-token', logger: () => {} });
  const { port } = await server.start();
  blobsURL = `http://127.0.0.1:${port}`;
  setEnvironmentContext({ siteID: 'local-test-site', token: 'local-blobs-token', edgeURL: `http://127.0.0.1:${port}`, uncachedEdgeURL: `http://127.0.0.1:${port}` });
}

before(async () => {
  process.env.API_AUTH_TOKEN = token;
  process.env.GEMINI_API_KEY = 'netlify-test-key';
  process.env.GEMINI_MODEL = 'gemini-3.1-flash-lite';
  directory = await mkdtemp(join(tmpdir(), 'ai-meal-netlify-test-'));
  await startBlobs();
  globalThis.fetch = async (request, options) => {
    const url = new URL(typeof request === 'string' ? request : request.url ?? request);
    if (url.hostname !== 'generativelanguage.googleapis.com') return originalFetch(request, options);
    modelCalls++;
    assert.equal(url.pathname, '/v1beta/models/gemini-3.1-flash-lite:generateContent');
    const req = new Request(request, options);
    assert.equal(req.headers.get('x-goog-api-key'), 'netlify-test-key');
    assert.equal((await req.json()).contents[0].parts[0].text, input);
    if (mode === 'failure') return Response.json({ error: { code: 400, message: 'sensitive-detail' } }, { status: 400 });
    return Response.json({ candidates: mode === 'empty' ? [] : [{ content: { role: 'model', parts: [{ text: output }] }, finishReason: mode === 'truncated' ? 'MAX_TOKENS' : 'STOP', index: 0 }] });
  };
});
after(async () => {
  globalThis.fetch = originalFetch;
  await server?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('Netlify route configuration and health preserve the API without leaking secrets', async () => {
  assert.deepEqual(config.path, ['/health', '/api/*']);
  const response = await call('/health', { authorized: false });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const health = await response.json();
  assert.equal(health.framework, 'google-adk-js');
  assert.equal(health.configured, true);
  assert.equal(JSON.stringify(health).includes(token), false);
});

test('Netlify rejects unauthorized and invalid requests before invoking Gemini', async () => {
  assert.equal((await call('/api/records', { authorized: false })).status, 401);
  assert.equal((await call('/api/analyze', { method: 'POST', body: { input }, authorized: false })).status, 401);
  for (const body of [{}, { input: 123 }, { input: ' ' }, { input: 'a'.repeat(2001) }]) {
    assert.equal((await call('/api/analyze', { method: 'POST', body })).status, 400);
  }
  assert.equal((await call('/api/analyze', { method: 'POST', raw: '{' })).status, 400);
  assert.equal((await call('/api/analyze', { method: 'POST', raw: 'a'.repeat(8193) })).status, 413);
  assert.equal((await call('/api/analyze', { method: 'POST', body: { input }, contentType: 'text/plain' })).status, 415);
  assert.equal(modelCalls, 0);
});

test('real ADK in Node saves through the real Blobs SDK and local server', async () => {
  const response = await call('/api/analyze', { method: 'POST', body: { input } });
  assert.equal(response.status, 201, await response.clone().text());
  const { record } = await response.json();
  assert.equal(record.input, input);
  assert.equal(record.output, output);
  assert.equal(modelCalls, 1);
  const history = await (await call('/api/records')).json();
  assert.deepEqual(history.records, [record]);
});

test('model errors, empty output and truncation never create success records', async () => {
  for (mode of ['failure', 'empty', 'truncated']) {
    const response = await call('/api/analyze', { method: 'POST', body: { input } });
    assert.equal(response.status, 502);
    assert.equal((await response.text()).includes('sensitive-detail'), false);
  }
  mode = 'success';
  assert.equal((await (await call('/api/records')).json()).records.length, 1);
});

test('Blobs records survive local server restart and preserve descending pagination', async () => {
  await server.stop();
  await startBlobs();
  assert.equal((await (await call('/api/records')).json()).records[0].output, output);
  const records = createRecordStore();
  const base = { input, output, model: 'test', created_at: '2099-01-01T00:00:00.000Z', duration_ms: 1 };
  await Promise.all(['a', 'b', 'c'].map(id => records.save({ ...base, id })));
  assert.deepEqual((await records.list(2, 1)).map(record => record.id), ['b', 'a']);
  assert.deepEqual(await records.list(1, 100), []);
  for (const query of ['limit=0', 'limit=51', 'offset=-1', 'offset=1.5']) {
    assert.equal((await call(`/api/records?${query}`)).status, 400);
  }
});

test('storage failure is sanitized and missing configuration fails safely', async () => {
  delete process.env.API_AUTH_TOKEN;
  assert.equal((await call('/api/records')).status, 503);
  process.env.API_AUTH_TOKEN = token;
  delete process.env.GEMINI_API_KEY;
  assert.equal((await call('/api/analyze', { method: 'POST', body: { input } })).status, 503);
  process.env.GEMINI_API_KEY = 'netlify-test-key';
  setEnvironmentContext({ siteID: 'local-test-site', token: 'incorrect', edgeURL: blobsURL, uncachedEdgeURL: blobsURL });
  // A server-side SDK error must not expose credentials or upstream details.
  const response = await call('/api/records');
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'STORAGE_OR_REQUEST_FAILED' });
});
