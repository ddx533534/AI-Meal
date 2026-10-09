import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { before, after, test } from 'node:test';
import { setEnvironmentContext } from '@netlify/blobs';
import { SessionTestBlobsServer } from '../scripts/local-blobs.mjs';
import { api, createMealSessionStore, createMenuMcp, formData, emptyFilters, queryMeals, createFoodStore } from '../.netlify/test-runtime.mjs';

import { menu } from './fixtures/meals.mjs';

const fetchOriginal = globalThis.fetch;
const token = 'meal-picker-test-only';
let directory, server, mode = 'ok', patch = {}, modelRequests = 0;
const filters = { ...emptyFilters, meal: 'lunch', budget: 30, spice: 'none' };
function call(path, { method = 'GET', body, authorized = true, raw, contentType = 'application/json' } = {}) {
  return api(new Request(`http://localhost/api/meal-picker/${path}`, { method,
    headers: { ...(authorized ? { authorization: `Bearer ${token}` } : {}), ...(body || raw ? { 'content-type': contentType } : {}) },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  }));
}
const action = (session, name, context = {}, text) => call('action', { method: 'POST', body: { ...(text ? { text } : {}), sessionId: session.id, revision: session.revision, action: { name, surfaceId: 'meal-picker', context } } });
const candidateIds = data => data.messages[2].updateComponents.components.filter(c => c.component === 'Card').map(c => c.id);
before(async () => {
  process.env.API_AUTH_TOKEN = token; process.env.GEMINI_API_KEY = 'test-key';
  directory = await mkdtemp(join(tmpdir(), 'ai-meal-picker-test-'));
  server = new SessionTestBlobsServer({ directory, token: 'blobs-test', logger: () => {} });
  const { port } = await server.start();
  setEnvironmentContext({ siteID: 'picker-test', token: 'blobs-test', edgeURL: `http://127.0.0.1:${port}`, uncachedEdgeURL: `http://127.0.0.1:${port}` });
  globalThis.fetch = async (request, options) => {
    const url = new URL(typeof request === 'string' ? request : request.url ?? request);
    if (url.hostname !== 'generativelanguage.googleapis.com') return fetchOriginal(request, options);
    modelRequests++;
    const body = await new Request(request, options).json();
    const outbound = JSON.stringify(body);
    for (const food of menu) { assert.equal(outbound.includes(food.name), false, 'saved food names stay inside server MCP'); assert.equal(outbound.includes(food.id), false, 'candidate IDs are not sent to the model'); }
    assert.equal(outbound.includes('\"price\":'), false, 'food price records are not sent to the model');
    assert.equal(body.contents.some(c => c.parts.some(p => p.functionResponse)), false, 'MCP result bypasses another model call');
    assert.equal(JSON.stringify(body.tools).includes('exclusiveMinimum'), false);
    assert.equal(body.toolConfig.functionCallingConfig.mode, 'ANY');
    if (mode === 'transient') { mode = 'ok'; return Response.json({ error: { code: 503, message: 'temporary' } }, { status: 503 }); }
    if (mode === 'timeout') {
      const signal = new Request(request, options).signal;
      return new Promise((_, reject) => {
        if (signal.aborted) return reject(signal.reason);
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    }
    if (mode === 'failure') return Response.json({ error: { code: 400, message: 'sensitive' } }, { status: 400 });
    const hasToolResponse = body.contents.some(c => c.parts.some(p => p.functionResponse));
    const tool = body.tools[0].functionDeclarations[0].name;
    const hasPatch = Boolean(body.tools[0].functionDeclarations[0].parameters.properties.patch);
    const parts = mode === 'missing' || hasToolResponse ? [{ text: '已查询演示菜单。' }] : [{ functionCall: { name: tool, args: hasPatch ? { patch } : {} } }];
    return Response.json({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP', index: 0 }] });
  };
});
after(async () => { globalThis.fetch = fetchOriginal; await server?.stop(); if (directory) await rm(directory, { recursive: true, force: true }); });

test('bootstrap uses validated official A2UI messages and never includes demo data', async () => {
  const data = await (await call('bootstrap')).json();
  assert.equal(data.session, null);
  assert.equal(data.messages[0].version, 'v0.9.1');
  assert.deepEqual(data.messages[1].updateDataModel.value.form.meal, []);
  assert.doesNotMatch(JSON.stringify(data.messages), /演示菜单|demo-/);
  assert.equal(modelRequests, 0);
});
test('real MCP discovery and calls enforce every hard filter and calculate budget recovery', async () => {
  const mcp = await createMenuMcp(menu);
  try {
    assert.deepEqual(mcp.discovery.sort(), ['get_meal', 'query_meals']);
    const result = await mcp.call('query_meals', { filters, page: 0 });
    assert.ok(result.total > 3);
    for (const meal of result.candidates) { assert.ok(meal.price <= 30); assert.equal(meal.spice, 'none'); }
    const none = await mcp.call('query_meals', { filters: { ...filters, budget: 1 }, page: 0 });
    assert.equal(none.total, 0); assert.equal(none.adjustment.budget, 16); assert.equal(none.adjustment.count, 1);
    assert.equal(mcp.evidence.length, 2);
  } finally { await mcp.close(); }
});
test('food validation, idempotency, empty menu and persistent listing', async () => {
  assert.deepEqual((await (await call('foods')).json()).foods, []);
  const empty = await (await call('session', { method: 'POST', body: { filters } })).json();
  assert.equal(empty.emptyMenu, true); assert.equal(modelRequests, 0);
  const input = { ...menu[0], id: crypto.randomUUID() };
  const first = await call('foods', { method: 'POST', body: input }); assert.equal(first.status, 201);
  assert.equal((await call('foods', { method: 'POST', body: input })).status, 200);
  assert.equal((await call('foods', { method: 'POST', body: { ...input, price: 19 } })).status, 409);
  for (const bad of [{ ...input, name: ' ' }, { ...input, meals: [] }, { ...input, price: -1 }, { ...input, price: 1.234 }, { ...input, extra: true }]) assert.equal((await call('foods', { method: 'POST', body: bad })).status, 400);
  assert.equal((await call('foods', { method: 'POST', body: input, authorized: false })).status, 401);
  assert.equal((await (await call('foods')).json()).foods.length, 1);
  assert.equal((await call(`foods?id=${input.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await call(`foods?id=bad`, { method: 'DELETE' })).status, 400);
  for (const item of menu) { const saved = await createFoodStore().create({ ...item, id: undefined }); item.id = saved.food.id; }
});
test('text ADK tool execution saves a Blobs session, rotates candidates and preserves filters', async () => {
  const response = await call('session', { method: 'POST', body: { filters, text: '按这些条件选午饭' } });
  assert.equal(response.status, 201, await response.clone().text());
  const first = await response.json();
  assert.deepEqual(first.session.filters, filters);
  const saved = await createMealSessionStore().read(first.session.id);
  assert.equal(saved.session.evidence.protocol, 'mcp');
  assert.equal(saved.session.evidence.calls[0].name, 'query_meals');
  const rotated = await (await action(first.session, 'rotate')).json();
  assert.deepEqual(rotated.session.filters, filters);
  assert.notDeepEqual(candidateIds(first), candidateIds(rotated));
  const changed = { ...filters, meal: 'dinner' };
  const updated = await (await action(rotated.session, 'update', { form: formData(changed) })).json();
  assert.deepEqual(updated.session.filters, changed);
  const selectedId = candidateIds(updated)[0];
  const selection = await (await action(updated.session, 'select', { id: selectedId })).json();
  assert.equal(selection.session.selected.id, selectedId);
  assert.equal(selection.session.selected.price, menu.find(m => m.id === selectedId).price);
  assert.match(JSON.stringify(selection.messages), /本次选择/);
  assert.equal((await action(updated.session, 'rotate')).status, 409);
  assert.equal((await call(`session?id=${first.session.id}`)).status, 200);
});
test('text conditions are extracted by an ADK tool call and missing fields remain explicit', async () => {
  patch = { meal: 'lunch', budget: 30, spice: 'none' };
  const response = await call('session', { method: 'POST', body: { text: '帮我选个午饭，预算30元，不要辣。' } });
  assert.equal(response.status, 201, await response.clone().text());
  assert.deepEqual((await response.json()).session.filters, filters);
  patch = {};
  const unspecified = await (await call('session', { method: 'POST', body: {} })).json();
  assert.equal(unspecified.session.filters.meal, null);
  assert.equal(unspecified.session.total, 0);
});
test('no-match conditions remain unchanged until the exact suggested budget action is chosen', async () => {
  const data = await (await call('session', { method: 'POST', body: { filters: { ...filters, budget: 1 } } })).json();
  assert.equal(data.session.filters.budget, 1);
  assert.match(JSON.stringify(data.messages), /没有符合条件的选项/);
  assert.equal((await action(data.session, 'adjust_budget', { budget: 30 })).status, 400);
  const revised = await (await action(data.session, 'adjust_budget', { budget: 16 })).json();
  assert.equal(revised.session.filters.budget, 16); assert.equal(revised.session.filters.spice, 'none'); assert.equal(revised.session.total, 1);
});
test('Blobs conditional writes reject two simultaneous revisions and stale ETags', async () => {
  const data = await (await call('session', { method: 'POST', body: { filters } })).json();
  const statuses = await Promise.all([action(data.session, 'rotate'), action(data.session, 'rotate')]);
  assert.deepEqual(statuses.map(r => r.status).sort(), [200, 409]);
  const store = createMealSessionStore(); const current = await store.read(data.session.id);
  assert.equal(await store.write({ ...current.session, revision: current.session.revision + 1 }, current.etag), true);
  assert.equal(await store.write(current.session, current.etag), false);
});
test('auth, malformed bodies, illegal actions and non-candidate selections are rejected', async () => {
  assert.equal((await call('bootstrap', { authorized: false })).status, 401);
  for (const body of [{ filters: { budget: -1 } }, { filters: { spice: 'invented' } }, { text: 'x'.repeat(2001) }, { unknown: 1 }]) assert.equal((await call('session', { method: 'POST', body })).status, 400);
  assert.equal((await call('session', { method: 'POST', raw: '{' })).status, 400);
  assert.equal((await call('session', { method: 'POST', raw: 'x'.repeat(8193) })).status, 413);
  assert.equal((await call('session', { method: 'POST', body: {}, contentType: 'text/plain' })).status, 415);
  const data = await (await call('session', { method: 'POST', body: { filters } })).json();
  assert.equal((await action(data.session, 'select', { id: menu[7].id })).status, 400);
  assert.equal((await action(data.session, 'update', { form: { ...formData(filters), unknown: 1 } })).status, 400);
});
test('model failure and absent tool calls leave previous successful state intact', async () => {
  const data = await (await call('session', { method: 'POST', body: { filters } })).json();
  for (mode of ['failure', 'missing']) {
    const response = await action(data.session, 'update', { form: formData(filters) }, '按原条件再找一次'); assert.equal(response.status, 502);
    assert.equal((await response.text()).includes('sensitive'), false);
    const saved = await createMealSessionStore().read(data.session.id); assert.equal(saved.session.revision, data.session.revision);
  }
  mode = 'ok';
});
test('one transient provider failure is retried before a single successful session commit', async () => {
  mode = 'transient';
  const before = modelRequests;
  const response = await call('session', { method: 'POST', body: { filters, text: '按原条件选午饭' } });
  assert.equal(response.status, 201);
  const data = await response.json();
  assert.equal(modelRequests - before, 2);
  assert.equal(data.session.revision, 1);
  assert.deepEqual(data.session.filters, filters);
});
test('exhausted model timeouts return a classified error and preserve the saved revision', async () => {
  const initial = await (await call('session', { method: 'POST', body: { filters } })).json();
  const before = modelRequests;
  const started = Date.now();
  mode = 'timeout';
  try {
    const response = await action(initial.session, 'update', { form: formData(filters) }, '按原条件再找一次');
    assert.equal(response.status, 502);
    assert.equal((await response.json()).reason, 'TIMEOUT');
    assert.equal(modelRequests - before, 2);
    assert.ok(Date.now() - started < 25000, 'both attempts complete below the observed Function deadline');
    const saved = await createMealSessionStore().read(initial.session.id);
    assert.equal(saved.session.revision, initial.session.revision);
  } finally { mode = 'ok'; }
});


test('guided meal question preserves text preferences and every click bypasses Gemini', async () => {
  patch = { budget: 20, taste: 'light' };
  const before = modelRequests;
  const data = await (await call('session', { method: 'POST', body: { text: '想吃清淡的，20元以内' } })).json();
  assert.equal(modelRequests, before + 1);
  assert.equal(data.session.step, 'need_meal');
  const components = data.messages[2].updateComponents.components;
  const events = components.filter(c => c.component === 'Button').map(c => c.action.event);
  assert.deepEqual(events.map(e => e.name), ['choose_meal', 'choose_meal']);
  assert.equal(components.some(c => c.component === 'ChoicePicker'), false);
  assert.equal(data.session.filters.budget, 20); assert.equal(data.session.filters.taste, 'light');
  const currentKey = process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY;
  try {
    const chosen = await (await action(data.session, 'choose_meal', { meal: 'lunch' })).json();
    assert.equal(chosen.session.step, 'candidates'); assert.equal(chosen.session.filters.budget, 20); assert.equal(chosen.session.filters.taste, 'light');
    const selected = await (await action(chosen.session, 'select', { id: candidateIds(chosen)[0] })).json();
    assert.equal(selected.session.step, 'selected');
    assert.equal(selected.messages[2].updateComponents.components.some(c => c.component === 'ChoicePicker'), false);
    assert.deepEqual(selected.messages[2].updateComponents.components.filter(c => c.component === 'Button').map(c => c.action.event.name), ['restart']);
    const restarted = await (await action(selected.session, 'restart')).json();
    assert.equal(restarted.session.step, 'start'); assert.deepEqual(restarted.session.filters, emptyFilters);
    const editing = await (await action(restarted.session, 'edit_filters')).json();
    assert.equal(editing.session.step, 'editing');
    assert.ok(editing.messages[2].updateComponents.components.some(c => c.component === 'ChoicePicker'));
    const saved = await createMealSessionStore().read(editing.session.id);
    assert.equal(saved.session.evidence.model, 'not-invoked');
    assert.equal(modelRequests, before + 1);
  } finally { process.env.GEMINI_API_KEY = currentKey; patch = {}; }
});
test('no-match alternatives have exact real counts, preserve all other filters and reject forged changes', async () => {
  const constrained = { ...filters, taste: 'light', staple: 'rice', spice: 'mild', budget: 10 };
  const data = await (await call('session', { method: 'POST', body: { filters: constrained } })).json();
  assert.equal(data.session.step, 'no_match');
  assert.match(JSON.stringify(data.messages), /超过了/);
  const expected = queryMeals(constrained, 0, menu);
  assert.equal(expected.adjustment.budget, 16);
  assert.equal((await action(data.session, 'relax_filter', { field: 'taste', value: 'any' })).status, 400);
  const recovered = await (await action(data.session, 'adjust_budget', { budget: 16 })).json();
  assert.deepEqual(recovered.session.filters, { ...constrained, budget: 16 });
  const needsSpice = { ...filters, staple: 'noodles', taste: 'light', spice: 'mild', budget: 100 };
  // With no single-field relaxation producing a new match, no invented option is offered.
  const impossible = { ...needsSpice, budget: 1 };
  const noOptions = queryMeals({ ...impossible, meal: null }, 0, menu);
  assert.equal(noOptions.alternatives.length, 0);
  for (const f of [constrained, { ...filters, meal: 'dinner', taste: 'light', staple: 'noodles', budget: 20 }]) {
    const result = queryMeals(f, 0, menu);
    for (const a of result.alternatives) assert.equal(a.count, queryMeals({ ...f, [a.field]: a.value }, 0, menu).total);
  }
  const dinner = { ...filters, meal: 'dinner', taste: 'light', staple: 'noodles', budget: 20 };
  const none = await (await call('session', { method: 'POST', body: { filters: dinner } })).json();
  const accepted = await (await action(none.session, 'relax_filter', { field: 'staple', value: 'any' })).json();
  assert.deepEqual(accepted.session.filters, { ...dinner, staple: 'any' }); assert.ok(accepted.session.total > 0);
  const isolated = [{ ...menu[0], spice: 'hot', staple: 'noodles', light: false }];
  const trulyImpossible = queryMeals({ ...filters, taste: 'light', staple: 'rice' }, 0, isolated);
  assert.equal(trulyImpossible.total, 0); assert.equal(trulyImpossible.adjustment, null); assert.deepEqual(trulyImpossible.alternatives, []);
  const otherMeal = queryMeals({ ...filters, meal: 'dinner', budget: 26, staple: 'rice', taste: 'any' }, 0, menu);
  assert.ok(otherMeal.total > 0);
});

test('deleted food and legacy demo sessions never reappear on session restoration', async () => {
  const data = await (await call('session', { method: 'POST', body: { filters } })).json();
  const id = candidateIds(data)[0];
  await call(`foods?id=${id}`, { method: 'DELETE' });
  const restored = await (await call(`session?id=${data.session.id}`)).json();
  assert.equal(candidateIds(restored).includes(id), false);
  assert.equal((await action(data.session, 'select', { id })).status, 400);
  const replacement = candidateIds(restored).find(candidate => !candidateIds(data).includes(candidate));
  assert.ok(replacement);
  assert.equal((await action(restored.session, 'select', { id: replacement })).status, 200);
  const store = createMealSessionStore(); const current = await store.read(data.session.id);
  const legacy = { ...current.session, id: crypto.randomUUID(), result: { ...current.session.result, source: 'demo-menu' } };
  await store.write(legacy);
  assert.equal((await call(`session?id=${legacy.id}`)).status, 404);
  assert.equal(await store.read(legacy.id), null);
});
