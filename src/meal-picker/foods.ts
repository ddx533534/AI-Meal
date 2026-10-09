import { getStore } from '@netlify/blobs';
import { z } from 'zod/v3';
import type { Meal } from './menu';

export const foodInputSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(80),
  price: z.number().min(0).max(10000).refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-8),
  meals: z.array(z.enum(['lunch', 'dinner'])).min(1).max(2).refine(a => new Set(a).size === a.length),
  spice: z.enum(['none', 'mild', 'hot']),
  staple: z.enum(['rice', 'noodles', 'other']),
  light: z.boolean(),
}).strict();
export type SavedFood = Meal & { createdAt: string };
export function createFoodStore() {
  const store = getStore({ name: 'ai-meal-foods', consistency: 'strong' });
  return {
    async list(): Promise<SavedFood[]> {
      const keys: string[] = [];
      for await (const page of store.list({ paginate: true })) keys.push(...page.blobs.map(b => b.key));
      const foods = await Promise.all(keys.map(key => store.get(key, { type: 'json' }) as Promise<SavedFood | null>));
      return foods.filter((food): food is SavedFood => food !== null).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    },
    async create(input: z.infer<typeof foodInputSchema>) {
      const food: SavedFood = { ...input, id: input.id ?? crypto.randomUUID(), createdAt: new Date().toISOString() };
      const written = await store.setJSON(food.id, food, { onlyIfNew: true });
      if (written.modified) return { food, created: true, conflict: false };
      const existing = await store.get(food.id, { type: 'json' }) as SavedFood | null;
      const fields = ['name', 'price', 'meals', 'spice', 'staple', 'light'] as const;
      const same = existing && fields.every(key => JSON.stringify(existing[key]) === JSON.stringify(food[key]));
      return { food: existing, created: false, conflict: !same };
    },
    async remove(id: string) { await store.delete(id); },
  };
}
