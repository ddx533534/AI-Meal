import { z } from 'zod/v3';

export const filtersSchema = z.object({
  meal: z.enum(['lunch', 'dinner']).nullable(),
  budget: z.number().positive().max(10000).nullable(),
  spice: z.enum(['none', 'mild', 'any']),
  staple: z.enum(['rice', 'noodles', 'any']),
  taste: z.enum(['light', 'any']),
}).strict();
export type Filters = z.infer<typeof filtersSchema>;
export const emptyFilters: Filters = { meal: null, budget: null, spice: 'any', staple: 'any', taste: 'any' };
export const filterPatchSchema = filtersSchema.partial();
export interface Meal {
  id: string; name: string; price: number; meals: Array<'lunch' | 'dinner'>;
  spice: 'none' | 'mild' | 'hot'; staple: 'rice' | 'noodles' | 'other'; light: boolean;
}
export function matches(meal: Meal, f: Filters): boolean {
  return f.meal !== null && meal.meals.includes(f.meal) &&
    (f.budget === null || meal.price <= f.budget) &&
    (f.spice === 'any' || (f.spice === 'none' ? meal.spice === 'none' : meal.spice !== 'hot')) &&
    (f.staple === 'any' || meal.staple === f.staple) && (f.taste === 'any' || meal.light);
}
export interface MealAlternative { field: 'spice' | 'staple' | 'taste' | 'meal'; value: 'any' | 'lunch' | 'dinner'; count: number }
export function queryMeals(filters: Filters, page: number, menu: readonly Meal[] = []) {
  const all = menu.filter(meal => matches(meal, filters));
  const pages = Math.ceil(all.length / 3);
  const index = pages ? page % pages : 0;
  const candidates = all.slice(index * 3, index * 3 + 3);
  const withoutBudget = menu.filter(meal => matches(meal, { ...filters, budget: null }));
  const minBudget = withoutBudget.length ? Math.min(...withoutBudget.map(m => m.price)) : null;
  const adjustment = !all.length && filters.budget !== null && minBudget !== null && minBudget > filters.budget
    ? { budget: minBudget, count: withoutBudget.filter(m => m.price <= minBudget).length } : null;
  const alternatives: MealAlternative[] = [];
  if (filters.meal && !all.length) {
    for (const field of ['spice', 'staple', 'taste'] as const) {
      if (filters[field] === 'any') continue;
      const count = menu.filter(meal => matches(meal, { ...filters, [field]: 'any' })).length;
      if (count) alternatives.push({ field, value: 'any', count });
    }
    const otherMeal = filters.meal === 'lunch' ? 'dinner' : 'lunch';
    const count = menu.filter(meal => matches(meal, { ...filters, meal: otherMeal })).length;
    if (count) alternatives.push({ field: 'meal', value: otherMeal, count });
  }
  const mealTotal = menu.filter(meal => filters.meal && meal.meals.includes(filters.meal)).length;
  let reason: string | null = null;
  if (filters.meal && !all.length) {
    const label = filters.meal === 'lunch' ? '午饭' : '晚饭';
    reason = !mealTotal ? `已录入的食物中，还没有适用于${label}的餐食。`
      : adjustment ? `符合其他条件的餐食最低为 ¥${adjustment.budget}，超过了你设定的 ¥${filters.budget} 预算。`
      : `已录入 ${mealTotal} 份${label}餐食，当前预算和口味组合没有匹配。`;
  }
  return { source: 'saved-foods', filters, candidates, total: all.length, pages, page: index, adjustment, alternatives, reason, menuTotal: menu.length };
}
export type QueryResult = ReturnType<typeof queryMeals>;
