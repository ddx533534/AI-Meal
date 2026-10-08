import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const netlify = process.argv.includes('--netlify');
const deployment = JSON.parse(await readFile(netlify ? 'deployment-netlify.json' : 'deployment.json', 'utf8'));
const base = new URL(deployment.url);
if (base.protocol !== 'https:' || !(netlify ? /^[a-z0-9-]+\.netlify\.app$/.test(base.hostname) && deployment.provider === 'netlify' && Boolean(deployment.siteId) : base.hostname === 'ai-meal-adk-verification.ai-meal-backend.workers.dev') || base.username || base.password) {
  throw new Error('Unexpected deployment URL; refusing to send the local authorization token.');
}
const { API_AUTH_TOKEN: token } = parseEnv(await readFile('.dev.vars', 'utf8'));
if (!token?.trim()) throw new Error('API_AUTH_TOKEN is not configured.');
const input = '云端验证：早餐吃了一个鸡蛋和一片面包，重量和配料未知。请只整理已知信息并指出缺失信息。';
const result = { verifiedAt: new Date().toISOString(), url: deployment.url, runtime: netlify ? 'Netlify Functions cloud' : 'Cloudflare Workers cloud', checks: [] };

async function call(path, { method = 'GET', authorized = true, body } = {}) {
  const start = Date.now();
  const response = await fetch(new URL(path, base), {
    method,
    redirect: 'manual',
    headers: {
      ...(authorized ? { authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(40_000),
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = undefined; }
  const check = {
    path, method, httpStatus: response.status, wallDurationMs: Date.now() - start,
    cfRay: response.headers.get('cf-ray'),
    ...(payload?.error ? { error: payload.error, reason: payload.reason } : {}),
    ...(!payload ? { nonJsonResponse: true, workerErrorCode: text.match(/(?:Error\s*|error code:\s*)(1\d{3})/i)?.[1] } : {}),
  };
  result.checks.push(check);
  console.log(JSON.stringify(check));
  return { response, payload };
}

try {
  const health = await call('/health', { authorized: false });
  assert.equal(health.response.status, 200, 'Cloud health failed');
  assert.equal(health.payload.framework, 'google-adk-js');
  assert.equal(health.payload.configured, true);
  result.model = health.payload.model;
  assert.equal((await call('/api/analyze', { method: 'POST', authorized: false, body: { input } })).response.status, 401);
  assert.equal((await call('/api/records', { authorized: false })).response.status, 401);
  assert.equal((await call('/api/analyze', { method: 'POST', body: { input: ' ' } })).response.status, 400);
  assert.equal((await call('/api/records?limit=0')).response.status, 400);
  const analysis = await call('/api/analyze', { method: 'POST', body: { input } });
  assert.equal(analysis.response.status, 201, 'Real cloud Gemini invocation failed');
  const record = analysis.payload.record;
  assert.equal(record.input, input);
  assert.ok(record.output?.trim());
  assert.equal(record.model, result.model);
  const history = await call('/api/records');
  assert.equal(history.response.status, 200);
  assert.deepEqual(history.payload.records.find(item => item.id === record.id), record);
  result.status = 'passed';
  result.realGeminiInvocation = 'passed';
  result[netlify ? 'remoteBlobsRoundTrip' : 'remoteD1RoundTrip'] = 'passed';
  result.record = record;
} catch (error) {
  result.status = 'failed';
  result.failureType = error?.name;
  if (typeof error?.cause?.code === 'string' && /^[A-Z0-9_]+$/.test(error.cause.code)) result.networkCode = error.cause.code;
  process.exitCode = 1;
} finally {
  await mkdir('verification', { recursive: true });
  await writeFile(netlify ? 'verification/netlify-cloud-smoke.local.json' : 'verification/cloud-smoke.local.json', JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
