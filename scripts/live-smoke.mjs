import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { curlOutbound } from './curl-outbound.mjs';

const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
if (!secrets.GEMINI_API_KEY || !secrets.API_AUTH_TOKEN) {
  throw new Error('Set GEMINI_API_KEY and API_AUTH_TOKEN in .dev.vars; do not put secrets in CLI arguments.');
}
const persistPath = await mkdtemp(join(tmpdir(), 'ai-meal-live-d1-'));
const model = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const systemTransport = process.argv.includes('--curl-outbound');
const options = convertV4MiniflareOptions({
  modules: true,
  scriptPath: resolve('dist/index.js'),
  compatibilityDate: '2026-10-08',
  d1Databases: { DB: 'live-smoke-records' },
  bindings: { ...secrets, GEMINI_MODEL: model },
  ...(systemTransport ? { outboundService: curlOutbound } : {}),
});
const mf = new Miniflare({ ...options, resourcePersistencePath: persistPath });
const result = {
  verifiedAt: new Date().toISOString(),
  runtime: 'local workerd',
  model,
  modelCall: 'real Gemini API request (no mock)',
  transport: systemTransport ? 'system curl bridge (local diagnostic only)' : 'native workerd fetch',
  database: 'local D1 (temporary)',
  cloudDeployment: 'not tested',
  freePlanCpuLimit: 'not tested',
};
try {
  const db = await mf.getD1Database('DB');
  const sql = await readFile('migrations/0001_records.sql', 'utf8');
  await db.exec(sql.replace(/\n/g, ' '));
  const start = Date.now();
  const response = await mf.dispatchFetch('http://localhost/api/analyze', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secrets.API_AUTH_TOKEN}`,
    },
    body: JSON.stringify({ input: '早餐吃了一个鸡蛋和一片面包，重量和配料未知。请只整理已知信息，并指出缺失信息。' }),
  });
  result.httpStatus = response.status;
  result.wallDurationMs = Date.now() - start;
  const payload = await response.json();
  if (response.status !== 201) {
    result.error = payload.error;
    result.reason = payload.reason;
    process.exitCode = 1;
  } else {
    assert.ok(payload.record.output.length > 0);
    const historyResponse = await mf.dispatchFetch('http://localhost/api/records', {
      headers: { authorization: `Bearer ${secrets.API_AUTH_TOKEN}` },
    });
    assert.equal(historyResponse.status, 200);
    const history = await historyResponse.json();
    assert.deepEqual(history.records, [payload.record]);
    result.status = 'passed';
    result.d1RoundTrip = 'passed';
    result.record = payload.record;
  }
} finally {
  await mf.dispose();
  await rm(persistPath, { recursive: true, force: true });
  await mkdir('verification', { recursive: true });
  const file = systemTransport ? 'verification/live-smoke-curl.local.json' : 'verification/live-smoke.local.json';
  await writeFile(file, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
