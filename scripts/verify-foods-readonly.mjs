import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { queryMeals, emptyFilters } from '../.netlify/test-runtime.mjs';

const deployment = JSON.parse(await readFile('deployment-netlify.json', 'utf8'));
const { API_AUTH_TOKEN: token } = parseEnv(await readFile('.dev.vars', 'utf8'));
if (deployment.url !== 'https://ai-meal-adk-verification-dream533534.netlify.app' || !token) throw new Error('Unexpected destination or missing credentials');
const quote = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
async function get(path, auth = true, method = "GET", body) {
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--config', '-', '--silent', '--show-error', '--max-time', '65', '--request', method, '--write-out', '\n%{http_code}', `${deployment.url}${path}`]);
    const lines = auth ? [`header = ${quote(`Authorization: Bearer ${token}`)}`] : [];
    if (body) lines.push('header = "Content-Type: application/json"', `data = ${quote(JSON.stringify(body))}`);
    child.stdin.end(lines.join('\n') + '\n');
    let out = ''; child.stdout.on('data', b => { out += b; }); child.stderr.resume();
    child.on('error', () => reject(new Error('Transport unavailable')));
    child.on('close', code => { if (code) return reject(new Error('Transport failed')); const i = out.lastIndexOf('\n'); resolve({ status: Number(out.slice(i + 1)), data: JSON.parse(out.slice(0, i)) }); });
  });
}
const query = process.argv.includes("--query");
let temporarySession;
const report = { at: new Date().toISOString(), deployId: deployment.deployId, mode: query ? 'existing food read + temporary selection session' : 'read only', checks: [] };
try {
  const [foods, bootstrap, records, unauthenticated] = await Promise.all([get('/api/meal-picker/foods'), get('/api/meal-picker/bootstrap'), get('/api/records'), get('/api/meal-picker/foods', false)]);
  assert.equal(foods.status, 200); assert.ok(Array.isArray(foods.data.foods));
  assert.equal(bootstrap.status, 200); assert.doesNotMatch(JSON.stringify(bootstrap.data), /演示菜单|demo-\d/);
  assert.equal(records.status, 200); assert.equal(unauthenticated.status, 401);
  report.foodCount = foods.data.foods.length;
  report.recordCount = records.data.records.length;
  report.checks = ['authenticated persistent food list', 'bootstrap has no demo menu', 'analysis history readable after cleanup', 'food API requires authentication'];
  if (query && foods.data.foods.length) {
    const menu = foods.data.foods.map(({ createdAt, ...meal }) => meal);
    const filters = { ...emptyFilters, meal: 'lunch', budget: 30 };
    const created = await get('/api/meal-picker/session', true, 'POST', { filters });
    assert.equal(created.status, 201); temporarySession = created.data.session.id;
    const expected = queryMeals(filters, 0, menu);
    assert.equal(created.data.session.total, expected.total);
    const cards = created.data.messages[2].updateComponents.components.filter(c => c.component === 'Card').map(c => c.id);
    assert.deepEqual(cards, expected.candidates.map(c => c.id));
    if (expected.candidates.length) {
      const selected = await get('/api/meal-picker/action', true, 'POST', { sessionId: temporarySession, revision: created.data.session.revision, action: { name: 'select', surfaceId: 'meal-picker', context: { id: expected.candidates[0].id } } });
      assert.equal(selected.status, 200); assert.deepEqual(selected.data.session.selected, expected.candidates[0]);
      report.checks.push('real model queried current saved foods and confirmed exact candidate and price');
    }
    report.modelMocked = false;
  }
  report.status = 'passed';
} catch (e) { report.status = 'failed'; report.failureType = e.name; process.exitCode = 1; }
if (temporarySession) { try { const removed = await get(`/api/meal-picker/session?id=${temporarySession}`, true, 'DELETE'); assert.equal(removed.status, 200); report.temporarySessionDeleted = true; } catch { report.status = 'failed'; report.cleanupFailed = true; process.exitCode = 1; } }
await writeFile(`verification/meal-foods-20261009/final-cloud-${query ? 'selection' : 'readonly'}.local.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
