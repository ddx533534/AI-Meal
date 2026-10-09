import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv } from 'node:util';
import { setEnvironmentContext } from '@netlify/blobs';
import { SessionTestBlobsServer } from './local-blobs.mjs';
import { api, createMealSessionStore, emptyFilters, formData, queryMeals } from '../.netlify/test-runtime.mjs';
import { curlOutbound } from './curl-outbound.mjs';

import { menu as fixtures } from '../tests/fixtures/meals.mjs';

let menu = [];
const createdFoods = new Set();
const cloud = process.argv.includes('--cloud');
const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
if (!secrets.API_AUTH_TOKEN || !secrets.GEMINI_API_KEY) throw new Error('Missing local service credentials');
process.env.API_AUTH_TOKEN = secrets.API_AUTH_TOKEN;
process.env.GEMINI_API_KEY = secrets.GEMINI_API_KEY;
process.env.GEMINI_MODEL = secrets.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const deployment = JSON.parse(await readFile('deployment-netlify.json', 'utf8'));
const nativeFetch = globalThis.fetch;
let server, directory;
const created = new Set();
const report = { status: 'running', mode: cloud ? 'Netlify production + real Gemini' : 'local Blobs SDK + real Gemini', model: process.env.GEMINI_MODEL, modelMocked: false, checks: [], startedAt: new Date().toISOString() };
const quote = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
async function request(path, method = 'GET', body, authorized = true) {
  if (!cloud) return api(new Request(`http://localhost/api/meal-picker/${path}`, { method, headers: { ...(authorized ? { authorization: `Bearer ${secrets.API_AUTH_TOKEN}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }));
  const config = [];
  if (authorized) config.push(`header = ${quote(`Authorization: Bearer ${secrets.API_AUTH_TOKEN}`)}`);
  if (body) config.push('header = "Content-Type: application/json"', `data = ${quote(JSON.stringify(body))}`);
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--config', '-', '--silent', '--show-error', '--max-time', '65', '--request', method, '--write-out', '\n%{http_code}', `${deployment.url}/api/meal-picker/${path}`]);
    child.stdin.end(config.join('\n') + '\n');
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.resume();
    child.on('error', () => reject(new Error('Cloud transport unavailable')));
    child.on('close', code => { if (code !== 0) return reject(new Error('Cloud transport failed')); const i = output.lastIndexOf('\n'); resolve(new Response(output.slice(0, i), { status: Number(output.slice(i + 1)) })); });
  });
}
async function checked(response, status) {
  const payload = await response.json();
  assert.equal(response.status, status, `HTTP ${response.status}: ${payload.error || 'unexpected response'}${payload.reason ? ` (${payload.reason})` : ''}`);
  if (status === 201 && payload.session) created.add(payload.session.id);
  return payload;
}
function verifyView(data, filters) {
  assert.deepEqual(data.session.filters, filters);
  const expected = queryMeals(filters, data.session.page, menu);
  assert.equal(data.session.total, expected.total);
  const ids = data.messages[2].updateComponents.components.filter(c => c.component === 'Card').map(c => c.id);
  if (!data.session.selected) assert.deepEqual(ids, expected.candidates.map(c => c.id));
  assert.ok(data.messages.every(m => m.version === 'v0.9.1'));
  return expected;
}
const action = (s, name, context = {}) => request('action', 'POST', { sessionId: s.id, revision: s.revision, action: { name, surfaceId: 'meal-picker', context } });
function passed(name, details = {}) { report.checks.push({ name, status: 'passed', ...details }); console.log(JSON.stringify({ check: name, status: 'passed' })); }
try {
  if (!cloud) {
    directory = await mkdtemp(join(tmpdir(), 'ai-meal-picker-live-'));
    server = new SessionTestBlobsServer({ directory, token: 'local-synthetic-blobs', logger: () => {} });
    const { port } = await server.start();
    setEnvironmentContext({ siteID: 'meal-live-test', token: 'local-synthetic-blobs', edgeURL: `http://127.0.0.1:${port}`, uncachedEdgeURL: `http://127.0.0.1:${port}` });
    globalThis.fetch = async (r, o) => { const req = new Request(r, o); if (new URL(req.url).hostname !== 'generativelanguage.googleapis.com') return nativeFetch(r, o); const res = await curlOutbound(req); return new Response(await res.text(), { status: res.status, headers: { 'content-type': 'application/json' } }); };
  }
  assert.equal((await request('bootstrap', 'GET', undefined, false)).status, 401);
  const bootstrap = await checked(await request('bootstrap'), 200);
  assert.deepEqual(bootstrap.messages[1].updateDataModel.value.form.meal, []);
  passed('authenticated bootstrap with no assumed meal');
  const existing = await checked(await request('foods'), 200);
  assert.equal(existing.foods.length, 0, 'Live acceptance requires an empty food library to avoid mixing test fixtures with user food');
  const empty = await checked(await request('session', 'POST', { filters: { ...emptyFilters, meal: 'lunch' } }), 200);
  assert.equal(empty.emptyMenu, true); assert.equal(empty.session, null);
  passed('empty menu is explicit and creates no fabricated candidates');
  for (const fixture of fixtures) {
    const input = { ...fixture, id: crypto.randomUUID(), name: `验收临时食物-${fixture.id}` };
    const added = await checked(await request('foods', 'POST', input), 201);
    createdFoods.add(added.food.id);
    const { createdAt, ...food } = added.food; menu.push(food);
    assert.equal((await request('foods', 'POST', input)).status, 200);
  }
  const listed = await checked(await request('foods'), 200);
  assert.equal(listed.foods.length, fixtures.length);
  passed('food entry persists exact input and retry does not duplicate it');
  const filters = { ...emptyFilters, meal: 'lunch', budget: 30, spice: 'none' };
  const initial = await checked(await request('session', 'POST', { text: '帮我选个午饭，预算30元，不要辣。' }), 201);
  const first = verifyView(initial, filters);
  passed('real model extracts explicit conditions; candidates exactly match MCP menu', { filters, candidateIds: first.candidates.map(c => c.id) });
  if (!cloud) {
    const saved = await createMealSessionStore().read(initial.session.id);
    assert.equal(saved.session.evidence.protocol, 'mcp');
    assert.equal(saved.session.evidence.calls[0].name, 'query_meals');
    report.mcpEvidence = saved.session.evidence;
    passed('real ADK FunctionTool crosses MCP client/server protocol');
  }
  const rotated = await checked(await action(initial.session, 'rotate'), 200);
  const next = verifyView(rotated, filters);
  assert.notDeepEqual(next.candidates, first.candidates);
  passed('rotate retains every hard condition');
  const selected = await checked(await action(rotated.session, 'select', { id: next.candidates[0].id }), 200);
  assert.deepEqual(selected.session.selected, next.candidates[0]);
  assert.match(JSON.stringify(selected.messages), /本次选择/);
  passed('selection confirms a real candidate with exact price');
  assert.equal((await action(rotated.session, 'rotate')).status, 409);
  const dinnerFilters = { ...filters, meal: 'dinner' };
  const updated = await checked(await action(selected.session, 'update', { form: formData(dinnerFilters) }), 200);
  verifyView(updated, dinnerFilters);
  passed('update one condition preserves budget and spice; stale revision rejected');
  const none = await checked(await request('session', 'POST', { filters: { ...filters, budget: 1 } }), 201);
  const recovery = verifyView(none, { ...filters, budget: 1 });
  assert.equal(recovery.total, 0); assert.equal(recovery.adjustment.budget, 16);
  const recovered = await checked(await action(none.session, 'adjust_budget', { budget: 16 }), 200);
  verifyView(recovered, { ...filters, budget: 16 });
  passed('budget changes only after exact recovery action');
  const concurrent = await Promise.all([action(updated.session, 'rotate'), action(updated.session, 'rotate')]);
  assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 409]);
  const restored = await checked(await request(`session?id=${updated.session.id}`), 200);
  assert.equal(restored.session.revision, updated.session.revision + 1);
  verifyView(restored, dinnerFilters);
  passed('atomic ETag conflict and restored session across requests');
  report.status = 'passed';
} catch (e) {
  report.status = 'failed'; report.failure = { type: e.name, message: e.message }; process.exitCode = 1;
} finally {
  for (const id of created) { try { assert.equal((await request(`session?id=${id}`, 'DELETE')).status, 200); } catch { report.cleanupFailed = true; report.status = 'failed'; process.exitCode = 1; } }
  for (const id of createdFoods) { try { assert.equal((await request(`foods?id=${id}`, 'DELETE')).status, 200); } catch { report.cleanupFailed = true; report.status = 'failed'; process.exitCode = 1; } }
  if (createdFoods.size) { try { const final = await checked(await request('foods'), 200); assert.equal(final.foods.length, 0); report.remainingFoods = final.foods.length; } catch { report.cleanupFailed = true; report.status = 'failed'; process.exitCode = 1; } }
  globalThis.fetch = nativeFetch;
  await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await mkdir('verification', { recursive: true });
  await writeFile(`verification/meal-picker-${cloud ? 'cloud' : 'live'}.local.json`, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
