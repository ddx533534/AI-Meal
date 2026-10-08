import { handleRequest, type ApiEnv, type MealRecord } from './api';

export interface Env extends Omit<ApiEnv, 'records'> {
  DB: D1Database;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, {
      ...env,
      records: {
        async save(record) {
          await env.DB.prepare(
            'INSERT INTO records (id, input, output, model, created_at, duration_ms) VALUES (?, ?, ?, ?, ?, ?)',
          ).bind(record.id, record.input, record.output, record.model, record.created_at, record.duration_ms).run();
        },
        async list(limit, offset) {
          const result = await env.DB.prepare(
            'SELECT id, input, output, model, created_at, duration_ms FROM records ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?',
          ).bind(limit, offset).all<MealRecord>();
          return result.results;
        },
      },
    });
  },
} satisfies ExportedHandler<Env>;
