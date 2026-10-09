import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { queryMeals, emptyFilters, formData } from '../.netlify/test-runtime.mjs';

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
let session;
const report = { at: new Date().toISOString(), deployId: deployment.deployId, mode: 'guided production acceptance', modelMocked: false, checks: [] };
const pass = name => { report.checks.push(name); console.log(JSON.stringify({ check: name, status: 'passed' })); };
async function checked(path, method = 'GET', body, status = 200) {
  const response = await get(path, true, method, body);
  assert.equal(response.status, status, `Unexpected HTTP ${response.status} at ${path.split('?')[0]} (${response.data.error ?? ''})`);
  return response.data;
}
async function act(current, name, context = {}) {
  const next = await checked('/api/meal-picker/action', 'POST', { sessionId: current.id, revision: current.revision, action: { name, surfaceId: 'meal-picker', context } });
  assert.equal(next.session.execution, 'direct');
  return next;
}
try {
  const initialFoods = (await checked('/api/meal-picker/foods')).foods;
  assert.ok(initialFoods.length, 'No saved food available; never seed synthetic production food');
  const menu = initialFoods.map(({ createdAt, ...meal }) => meal);
  const created = await checked('/api/meal-picker/session', 'POST', { text: '想吃清淡的，20元以内。餐别还没决定。' }, 201);
  session = created.session.id;
  assert.equal(created.session.execution, 'adk'); assert.equal(created.session.step, 'need_meal');
  assert.equal(created.session.filters.meal, null); assert.equal(created.session.filters.budget, 20); assert.equal(created.session.filters.taste, 'light');
  const components = created.messages[2].updateComponents.components;
  assert.equal(components.some(c => c.component === 'ChoicePicker'), false);
  assert.deepEqual(components.filter(c => c.component === 'Button').map(c => c.action.event.name), ['choose_meal', 'choose_meal']);
  pass('real ADK text parsing leads to only the missing meal question');
  const meal = menu.some(f => f.meals.includes('lunch')) ? 'lunch' : 'dinner';
  let next = await act(created.session, 'choose_meal', { meal });
  const filters = { ...emptyFilters, budget: 20, taste: 'light', meal };
  assert.deepEqual(next.session.filters, filters);
  assert.equal(next.session.total, queryMeals(filters, 0, menu).total);
  pass('meal click preserves all preferences and executes direct MCP');
  if (next.session.step === 'no_match') {
    const expected = queryMeals(next.session.filters, 0, menu);
    assert.match(JSON.stringify(next.messages), /没有符合条件/);
    if (expected.adjustment) {
      next = await act(next.session, 'adjust_budget', { budget: expected.adjustment.budget });
      assert.deepEqual(next.session.filters, { ...filters, budget: expected.adjustment.budget });
    } else if (expected.alternatives.length) {
      const a = expected.alternatives[0]; next = await act(next.session, 'relax_filter', { field: a.field, value: a.value });
      assert.deepEqual(next.session.filters, { ...filters, [a.field]: a.value });
    } else {
      next = await act(next.session, 'edit_filters');
      next = await act(next.session, 'update', { form: formData({ ...emptyFilters, meal }) });
    }
    assert.equal(next.session.step, 'candidates');
    pass('no-match explains constraints and only changes user-selected conditions');
  }
  const expected = queryMeals(next.session.filters, 0, menu);
  const chosen = expected.candidates[0]; assert.ok(chosen);
  const selected = await act(next.session, 'select', { id: chosen.id });
  assert.deepEqual(selected.session.selected, chosen); assert.equal(selected.session.step, 'selected');
  assert.deepEqual(selected.messages[2].updateComponents.components.filter(c => c.component === 'Button').map(c => c.action.event.name), ['restart']);
  pass('confirmation folds into the final choice, with no model call');
  const restored = await checked(`/api/meal-picker/session?id=${session}`);
  assert.equal(restored.session.step, 'selected'); assert.deepEqual(restored.session.selected, chosen);
  const restart = await act(restored.session, 'restart'); assert.deepEqual(restart.session.filters, emptyFilters); assert.equal(restart.session.step, 'start');
  const stale = await get('/api/meal-picker/action', true, 'POST', { sessionId: session, revision: restored.session.revision, action: { name: 'restart', surfaceId: 'meal-picker', context: {} } });
  assert.equal(stale.status, 409);
  pass('final choice restores, restart is explicit and stale revisions are rejected');
  // Force a grounded budget conflict using an actual positive-price pool.
  let budgetCase;
  for (const m of ['lunch', 'dinner']) for (const taste of ['light', 'any']) for (const staple of ['rice', 'noodles', 'any']) for (const spice of ['none', 'mild', 'any']) {
    const f = { meal: m, taste, staple, spice, budget: null };
    const pool = queryMeals(f, 0, menu);
    if (pool.total) {
      const prices = menu.filter(food => food.meals.includes(m) && (taste === 'any' || food.light) && (staple === 'any' || food.staple === staple) && (spice === 'any' || (spice === 'none' ? food.spice === 'none' : food.spice !== 'hot'))).map(f => f.price);
      const minimum = Math.min(...prices);
      if (!budgetCase && minimum > 0) budgetCase = { ...f, budget: minimum / 2 };
    }
  }
  if (budgetCase) {
    const bad = await act(restart.session, 'update', { form: formData(budgetCase) });
    assert.equal(bad.session.step, 'no_match');
    const expectedBad = queryMeals(budgetCase, 0, menu);
    assert.ok(expectedBad.adjustment); assert.match(JSON.stringify(bad.messages), /超过了/);
    const recovered = await act(bad.session, 'adjust_budget', { budget: expectedBad.adjustment.budget });
    assert.deepEqual(recovered.session.filters, { ...budgetCase, budget: expectedBad.adjustment.budget });
    assert.equal(recovered.session.total, expectedBad.adjustment.count);
    pass('actual lowest-price conflict and exact budget recovery verified without model');
  } else report.budgetRecoveryCase = 'not available in current saved foods';
  const finalFoods = (await checked('/api/meal-picker/foods')).foods;
  for (const food of initialFoods) assert.deepEqual(finalFoods.find(f => f.id === food.id), food);
  report.foodsBefore = initialFoods.length; report.foodsAfter = finalFoods.length;
  pass('existing food entries preserved exactly'); report.status = 'passed';
} catch (e) { report.status = 'failed'; report.failure = { type: e.name, message: e.message }; process.exitCode = 1; }
finally {
  if (session) { try { await checked(`/api/meal-picker/session?id=${session}`, 'DELETE'); report.temporarySessionDeleted = true; } catch { report.cleanupFailed = true; report.status = 'failed'; process.exitCode = 1; } }
  report.finishedAt = new Date().toISOString();
  await writeFile('verification/meal-guided-20261009/cloud.local.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
