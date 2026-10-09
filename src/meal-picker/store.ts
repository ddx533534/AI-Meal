import { getStore } from '@netlify/blobs';
import type { Filters, QueryResult, Meal } from './menu';
import type { AgentResult } from './agent';

export interface MealSession {
  fresh?: boolean; editing?: boolean; id: string; revision: number; filters: Filters; result: QueryResult;
  selected: Meal | null; evidence: AgentResult['evidence']; createdAt: string; updatedAt: string;
}
export function createMealSessionStore() {
  // ETag conditions are enforced by Blobs, across function instances.
  const store = getStore({ name: 'ai-meal-picker-sessions', consistency: 'strong' });
  return {
    async read(id: string): Promise<{ session: MealSession; etag: string } | null> {
      const entry = await store.getWithMetadata(id, { type: 'json' });
      if (!entry) return null;
      if (!entry.etag) throw new Error('SESSION_ETAG_MISSING');
      return { session: entry.data as MealSession, etag: entry.etag };
    },
    async write(session: MealSession, etag?: string): Promise<boolean> {
      const result = await store.setJSON(session.id, session, etag ? { onlyIfMatch: etag } : { onlyIfNew: true });
      return result.modified;
    },
    async remove(id: string) { await store.delete(id); },
  };
}
