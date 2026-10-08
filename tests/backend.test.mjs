import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { after, before, test } from 'node:test';
import { Miniflare, Response, convertV4MiniflareOptions } from 'miniflare';

// The ADK and Worker are real. Only the remote Gemini HTTP response is mocked.
const token = 'test-only-token';
const input = '早餐吃了一个鸡蛋，食物重量未知。';
const output = '模拟模型响应：早餐包含一个鸡蛋，重量未知。';
let mf;
let persistPath;
let upstreamMode = 'success';
let modelCalls = 0;

function runtimeOptions() {
  const options = convertV4MiniflareOptions({
    modules: true,
    scriptPath: resolve('dist/index.js'),
    compatibilityDate: '2026-10-08',
    d1Databases: { DB: 'test-ai-meal-records' },
    bindings: {
      API_AUTH_TOKEN: token,
      GEMINI_API_KEY: 'test-only-key',
      GEMINI_MODEL: 'gemini-3.1-flash-lite',
    },
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.hostname, 'generativelanguage.googleapis.com');
      assert.equal(url.pathname, '/v1beta/models/gemini-3.1-flash-lite:generateContent');
      assert.equal(request.method, 'POST');
      assert.equal(request.headers.get('x-goog-api-key'), 'test-only-key');
      const body = await request.json();
      assert.equal(body.contents[0].parts[0].text, input);
      modelCalls++;
      if (upstreamMode === 'failure') {
        return Response.json({ error: { code: 400, message: 'sensitive-upstream-detail' } }, { status: 400 });
      }
      if (upstreamMode === 'empty') return Response.json({ candidates: [] });
      return Response.json({
        candidates: [{
          content: { role: 'model', parts: [{ text: output }] },
          finishReason: upstreamMode === 'truncated' ? 'MAX_TOKENS' : 'STOP',
          index: 0,
        }],
        usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 20, totalTokenCount: 32 },
        modelVersion: 'gemini-mocked-for-runtime-test',
      });
    },
  });
  // Miniflare 5 uses a shared resource persistence root; the v4 converter
  // does not carry over d1Persist.
  return { ...options, resourcePersistencePath: persistPath };
}

function call(path, { method = 'GET', body, authorized = true, rawBody, contentType = 'application/json' } = {}) {
  return mf.dispatchFetch(`http://localhost${path}`, {
    method,
    headers: {
      ...(authorized ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined || rawBody !== undefined ? { 'content-type': contentType } : {}),
    },
    body: rawBody ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });
}

before(async () => {
  persistPath = await mkdtemp(join(tmpdir(), 'ai-meal-d1-test-'));
  mf = new Miniflare(runtimeOptions());
  const db = await mf.getD1Database('DB');
  const sql = await readFile('migrations/0001_records.sql', 'utf8');
  await db.exec(sql.replace(/\n/g, ' '));
});

after(async () => {
  await mf?.dispose();
  if (persistPath) await rm(persistPath, { recursive: true, force: true });
});

test('the actual Worker starts and ADK imports in workerd', async () => {
  const response = await call('/health', { authorized: false });
  assert.equal(response.status, 200);
  const health = await response.json();
  assert.equal(health.framework, 'google-adk-js');
  assert.equal(health.configured, true);
  assert.equal(JSON.stringify(health).includes(token), false);
});

test('AI calls and history require authorization', async () => {
  for (const [path, method] of [['/api/analyze', 'POST'], ['/api/records', 'GET']]) {
    const response = await call(path, { method, authorized: false, body: method === 'POST' ? { input } : undefined });
    assert.equal(response.status, 401);
  }
  assert.equal(modelCalls, 0);
});

test('invalid, malformed and oversized input never calls the model', async () => {
  for (const body of [{}, { input: 123 }, { input: ' ' }, { input: 'a'.repeat(2001) }]) {
    assert.equal((await call('/api/analyze', { method: 'POST', body })).status, 400);
  }
  assert.equal((await call('/api/analyze', { method: 'POST', rawBody: '{' })).status, 400);
  assert.equal((await call('/api/analyze', { method: 'POST', rawBody: 'a'.repeat(8193) })).status, 413);
  assert.equal((await call('/api/analyze', { method: 'POST', body: { input }, contentType: 'text/plain' })).status, 415);
  assert.equal(modelCalls, 0);
});

test('real ADK calls Gemini protocol and writes the result to local D1', async () => {
  const response = await call('/api/analyze', { method: 'POST', body: { input } });
  assert.equal(response.status, 201, await response.clone().text());
  const { record } = await response.json();
  assert.equal(record.input, input);
  assert.equal(record.output, output);
  assert.match(record.id, /^[0-9a-f-]{36}$/);
  assert.equal(modelCalls, 1);
  const history = await (await call('/api/records')).json();
  assert.deepEqual(history.records, [record]);
});

test('model failure returns a sanitized error and does not save a successful record', async () => {
  upstreamMode = 'failure';
  const response = await call('/api/analyze', { method: 'POST', body: { input } });
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: 'MODEL_REQUEST_FAILED', reason: 'MODEL_400' });
  const history = await (await call('/api/records')).json();
  assert.equal(history.records.length, 1);
  upstreamMode = 'success';
});

test('empty or truncated model output is rejected and never saved', async () => {
  for (const [mode, reason] of [['empty', 'MODEL_UNKNOWN_ERROR'], ['truncated', 'OUTPUT_LIMIT_REACHED']]) {
    upstreamMode = mode;
    const response = await call('/api/analyze', { method: 'POST', body: { input } });
    assert.equal(response.status, 502);
    assert.deepEqual(await response.json(), { error: 'MODEL_REQUEST_FAILED', reason });
  }
  const history = await (await call('/api/records')).json();
  assert.equal(history.records.length, 1);
  upstreamMode = 'success';
});

test('history is paginated and invalid pagination is rejected', async () => {
  assert.equal((await call('/api/records?limit=0')).status, 400);
  assert.equal((await call('/api/records?limit=51')).status, 400);
  assert.equal((await call('/api/records?offset=-1')).status, 400);
  assert.equal((await call('/api/records?offset=1.5')).status, 400);
  const page = await (await call('/api/records?limit=1&offset=1')).json();
  assert.deepEqual(page.records, []);
});

test('D1 records survive a complete local Worker/runtime restart', async () => {
  await mf.dispose();
  mf = new Miniflare(runtimeOptions());
  const response = await call('/api/records');
  assert.equal(response.status, 200);
  const history = await response.json();
  assert.equal(history.records.length, 1);
  assert.equal(history.records[0].output, output);
});
