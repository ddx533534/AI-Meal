import { analyze, ModelInvocationError } from './agent';

export interface MealRecord {
  id: string;
  input: string;
  output: string;
  model: string;
  created_at: string;
  duration_ms: number;
}

export interface RecordStore {
  save(record: MealRecord): Promise<void>;
  list(limit: number, offset: number): Promise<MealRecord[]>;
}

export interface ApiEnv {
  records: RecordStore;
  GEMINI_API_KEY?: string;
  API_AUTH_TOKEN?: string;
  GEMINI_MODEL: string;
}

const MAX_BODY_BYTES = 8_192;
const MAX_INPUT_LENGTH = 2_000;

function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  });
}

async function readInput(request: Request): Promise<string | Response> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return json({ error: 'JSON_REQUIRED' }, 415);
  }
  const reader = request.body?.getReader();
  if (!reader) return json({ error: 'INVALID_INPUT' }, 400);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        return json({ error: 'BODY_TOO_LARGE' }, 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes));
    if (typeof body !== 'object' || body === null || !('input' in body)) {
      return json({ error: 'INVALID_INPUT' }, 400);
    }
    if (typeof body.input !== 'string') return json({ error: 'INVALID_INPUT' }, 400);
    const input = body.input.trim();
    if (!input || input.length > MAX_INPUT_LENGTH) {
      return json({ error: 'INVALID_INPUT', maxLength: MAX_INPUT_LENGTH }, 400);
    }
    return input;
  } catch {
    return json({ error: 'INVALID_JSON' }, 400);
  }
}

function pageInteger(value: string | null, fallback: number, min: number, max: number): number | undefined {
  if (value === null) return fallback;
  if (!/^\d+$/.test(value)) return undefined;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : undefined;
}

export async function handleRequest(request: Request, env: ApiEnv): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/health') {
    return json({
      status: 'ok',
      framework: 'google-adk-js',
      model: env.GEMINI_MODEL,
      configured: Boolean(env.GEMINI_API_KEY?.trim() && env.API_AUTH_TOKEN?.trim()),
    });
  }
  if (!env.API_AUTH_TOKEN?.trim()) return json({ error: 'AUTH_NOT_CONFIGURED' }, 503);
  if (request.headers.get('authorization') !== `Bearer ${env.API_AUTH_TOKEN}`) {
    return json({ error: 'UNAUTHORIZED' }, 401);
  }
  try {
    if (request.method === 'POST' && url.pathname === '/api/analyze') {
      const input = await readInput(request);
      if (input instanceof Response) return input;
      if (!env.GEMINI_API_KEY?.trim()) return json({ error: 'GEMINI_NOT_CONFIGURED' }, 503);
      const started = Date.now();
      let output: string;
      try {
        output = await analyze(input, env.GEMINI_API_KEY, env.GEMINI_MODEL);
      } catch (error) {
        // Do not return upstream errors: these may contain prompts or credentials.
        return json({
          error: 'MODEL_REQUEST_FAILED',
          reason: error instanceof ModelInvocationError ? error.reason : 'UNKNOWN',
        }, 502);
      }
      const record = {
        id: crypto.randomUUID(),
        input,
        output,
        model: env.GEMINI_MODEL,
        created_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      };
      await env.records.save(record);
      return json({ record }, 201);
    }
    if (request.method === 'GET' && url.pathname === '/api/records') {
      const limit = pageInteger(url.searchParams.get('limit'), 20, 1, 50);
      const offset = pageInteger(url.searchParams.get('offset'), 0, 0, 10_000);
      if (limit === undefined || offset === undefined) return json({ error: 'INVALID_PAGINATION' }, 400);
      const records = await env.records.list(limit, offset);
      return json({ records, limit, offset });
    }
    return json({ error: 'NOT_FOUND' }, 404);
  } catch {
    return json({ error: 'STORAGE_OR_REQUEST_FAILED' }, 500);
  }
}
