import { z } from 'zod/v3';
import { buildA2ui, surfaceId } from './a2ui';
import { emptyFilters, filterPatchSchema, filtersSchema, queryMeals, type Meal } from './menu';
import { createFoodStore, foodInputSchema } from './foods';
import { runMealAgent, runMealTools } from './agent';
import { mealStep } from './flow';
import { ModelInvocationError } from '../agent';
import { createMealSessionStore, type MealSession } from './store';

const sessionId = z.string().uuid();
const eventSchema = z.object({ name: z.enum(['update', 'rotate', 'select', 'adjust_budget', 'choose_meal', 'relax_filter', 'edit_filters', 'restart']), surfaceId: z.literal(surfaceId), context: z.record(z.unknown()) }).strict();
const actionSchema = z.object({ sessionId, revision: z.number().int().min(1), action: eventSchema, text: z.string().trim().max(2000).optional() }).strict();
const createSchema = z.object({ text: z.string().trim().max(2000).optional(), filters: filterPatchSchema.optional(), editing: z.boolean().optional() }).strict();
const formSchema = z.object({ meal: z.array(z.enum(['lunch', 'dinner'])).max(1), budget: z.array(z.enum(['20', '30', '40', 'any', 'custom'])).length(1), customBudget: z.string().max(16), spice: z.array(z.enum(['none', 'mild', 'any'])).length(1), staple: z.array(z.enum(['rice', 'noodles', 'any'])).length(1), taste: z.array(z.enum(['light', 'any'])).length(1) }).strict();
export function filtersFromForm(raw: unknown) {
  const f = formSchema.parse(raw);
  const budget = f.budget[0] === 'any' ? null : f.budget[0] === 'custom' ? Number(f.customBudget) : Number(f.budget[0]);
  return filtersSchema.parse({ meal: f.meal[0] ?? null, budget, spice: f.spice[0], staple: f.staple[0], taste: f.taste[0] });
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
function view(s: MealSession, menu?: Meal[]) {
  if (menu) s = { ...s, result: queryMeals(s.filters, s.result.page, menu), selected: menu.find(m => m.id === s.selected?.id) ?? null };
  return { session: { id: s.id, revision: s.revision, filters: s.filters, selected: s.selected, total: s.result.total, page: s.result.page, step: mealStep(s.filters, s.fresh ? undefined : s.result, s.selected, s.editing), execution: s.evidence.framework === 'deterministic-actions' ? 'direct' : 'adk' }, messages: buildA2ui(s.filters, s.fresh ? undefined : s.result, s.selected, false, s.editing) };
}
async function body(request: Request): Promise<unknown | Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) return json({ error: 'JSON_REQUIRED' }, 415);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'INVALID_INPUT' }, 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length; if (size > 8192) { await reader.cancel(); return json({ error: 'BODY_TOO_LARGE' }, 413); } chunks.push(part.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)); } catch { return json({ error: 'INVALID_JSON' }, 400); }
}
export async function handleMealPicker(request: Request, env: { API_AUTH_TOKEN?: string; GEMINI_API_KEY?: string; GEMINI_MODEL: string }) {
  if (!env.API_AUTH_TOKEN?.trim()) return json({ error: 'AUTH_NOT_CONFIGURED' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${env.API_AUTH_TOKEN}`) return json({ error: 'UNAUTHORIZED' }, 401);
  const url = new URL(request.url);
  try {
    const foods = createFoodStore();
    if (url.pathname === '/api/meal-picker/foods') {
      if (request.method === 'GET') return json({ foods: await foods.list() });
      if (request.method === 'POST') {
        const raw = await body(request); if (raw instanceof Response) return raw;
        const saved = await foods.create(foodInputSchema.parse(raw));
        return saved.conflict ? json({ error: 'FOOD_CONFLICT' }, 409) : json({ food: saved.food }, saved.created ? 201 : 200);
      }
      if (request.method === 'DELETE') {
        await foods.remove(sessionId.parse(url.searchParams.get('id'))); return json({ deleted: true });
      }
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    }
    if (request.method === 'GET' && url.pathname === '/api/meal-picker/bootstrap') return json({ session: null, messages: buildA2ui(emptyFilters) });
    const store = createMealSessionStore();
    const menu = (await foods.list()).map(({ createdAt, ...meal }) => meal);
    const legacy = (s: MealSession) => s.result.source !== 'saved-foods';
    if (request.method === 'GET' && url.pathname === '/api/meal-picker/session') {
      const id = sessionId.parse(url.searchParams.get('id'));
      const current = await store.read(id);
      if (current && legacy(current.session)) { await store.remove(id); return json({ error: 'SESSION_NOT_FOUND' }, 404); }
      return current ? json(view(current.session, menu)) : json({ error: 'SESSION_NOT_FOUND' }, 404);
    }
    if (request.method === 'DELETE' && url.pathname === '/api/meal-picker/session') {
      const id = sessionId.parse(url.searchParams.get('id')); await store.remove(id); return json({ deleted: true });
    }
    if (request.method !== 'POST' || !['/api/meal-picker/session', '/api/meal-picker/action'].includes(url.pathname)) return json({ error: 'NOT_FOUND' }, 404);
    const raw = await body(request); if (raw instanceof Response) return raw;
    let previous: MealSession | undefined; let etag: string | undefined;
    let filters = { ...emptyFilters }; let text: string | undefined; let page = 0; let selectedId: string | undefined; let editing = false; let fresh = false;
    if (url.pathname.endsWith('/action')) {
      const input = actionSchema.parse(raw);
      const current = await store.read(input.sessionId);
      if (!current || legacy(current.session)) return json({ error: 'SESSION_NOT_FOUND' }, 404);
      previous = current.session; etag = current.etag;
      if (previous.revision !== input.revision) return json({ error: 'SESSION_CONFLICT', ...view(previous, menu) }, 409);
      filters = previous.filters; text = input.text;
      const context = input.action.context;
      switch (input.action.name) {
        case 'update': filters = filtersFromForm(z.object({ form: z.unknown() }).strict().parse(context).form); break;
        case 'rotate': z.object({}).strict().parse(context); page = previous.result.page + 1; text = undefined; break;
        case 'select': selectedId = z.object({ id: z.string() }).strict().parse(context).id; if ((!previous.result.candidates.some(m => m.id === selectedId) && !queryMeals(filters, previous.result.page, menu).candidates.some(m => m.id === selectedId)) || !menu.some(m => m.id === selectedId)) return json({ error: 'INVALID_SELECTION' }, 400); page = previous.result.page; text = undefined; break;
        case 'choose_meal': filters = { ...filters, meal: z.object({ meal: z.enum(['lunch', 'dinner']) }).strict().parse(context).meal }; text = undefined; break;
        case 'relax_filter': {
          const choice = z.object({ field: z.enum(['spice', 'staple', 'taste', 'meal']), value: z.enum(['any', 'lunch', 'dinner']) }).strict().parse(context);
          if (!queryMeals(filters, 0, menu).alternatives.some(a => a.field === choice.field && a.value === choice.value)) return json({ error: 'INVALID_ADJUSTMENT' }, 400);
          filters = filtersSchema.parse({ ...filters, [choice.field]: choice.value }); text = undefined; break;
        }
        case 'edit_filters': z.object({}).strict().parse(context); editing = true; text = undefined; break;
        case 'restart': z.object({}).strict().parse(context); filters = { ...emptyFilters }; text = undefined; fresh = true; break;
        case 'adjust_budget': {
          const budget = z.object({ budget: z.number() }).strict().parse(context).budget;
          if (queryMeals(filters, 0, menu).adjustment?.budget !== budget) return json({ error: 'INVALID_ADJUSTMENT' }, 400);
          filters = { ...filters, budget }; text = undefined; break;
        }
      }
    } else { const input = createSchema.parse(raw); filters = filtersSchema.parse({ ...emptyFilters, ...input.filters }); text = input.text; editing = input.editing ?? false; }
    if (!menu.length) return json({ session: null, messages: buildA2ui(filters), emptyMenu: true });
    if (text && !env.GEMINI_API_KEY?.trim()) return json({ error: 'GEMINI_NOT_CONFIGURED' }, 503);
    let agent;
    if (!text) agent = await runMealTools({ filters, page, menu, selectedId });
    // Two bounded attempts plus backoff must leave room below the observed
    // 30-second Function limit for cold start, MCP, validation and Blobs writes.
    for (let attempt = 0; text && attempt < 2; attempt++) {
      try { agent = await runMealAgent({ filters, page, menu, text, selectedId, apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL, timeoutMs: 10000 }); break; }
      catch (error) {
        const reason = error instanceof ModelInvocationError ? error.reason : 'UNKNOWN';
        console.warn(JSON.stringify({ event: 'meal_picker_model_failure', reason, attempt: attempt + 1 }));
        // Retry a transient provider failure once, before any session is written.
        if (attempt === 0 && /^(MODEL_|UPSTREAM_HTTP_)(429|500|502|503|504)$|^TIMEOUT$/.test(reason)) { await new Promise(resolve => setTimeout(resolve, 300)); continue; }
        return json({ error: 'MODEL_REQUEST_FAILED', reason }, 502);
      }
    }
    if (!agent) return json({ error: 'MODEL_REQUEST_FAILED', reason: 'UNKNOWN' }, 502);
    const now = new Date().toISOString();
    const next: MealSession = { fresh, editing, id: previous?.id ?? crypto.randomUUID(), revision: (previous?.revision ?? 0) + 1, filters: agent.filters, result: agent.result, selected: agent.selected, evidence: agent.evidence, createdAt: previous?.createdAt ?? now, updatedAt: now };
    const response = view(next); // Validate A2UI before committing successful state.
    if (!await store.write(next, etag)) {
      const current = await store.read(next.id);
      return json({ error: 'SESSION_CONFLICT', ...(current ? view(current.session, menu) : {}) }, 409);
    }
    return json(response, previous ? 200 : 201);
  } catch (error) {
    if (error instanceof z.ZodError) return json({ error: 'INVALID_INPUT' }, 400);
    return json({ error: 'STORAGE_OR_REQUEST_FAILED' }, 500);
  }
}
