import type { Filters, Meal, QueryResult } from './menu';

export function mealStep(filters: Filters, result?: QueryResult, selected?: Meal | null, editing = false) {
  if (editing) return 'editing';
  if (selected) return 'selected';
  if (!result) return 'start';
  if (!filters.meal) return 'need_meal';
  return result.total ? 'candidates' : 'no_match';
}
export function filterSummary(f: Filters) {
  return [f.meal === 'lunch' ? '午饭' : f.meal === 'dinner' ? '晚饭' : null,
    f.budget === null ? '预算不限' : `¥${f.budget} 以内`,
    f.spice === 'none' ? '不辣' : f.spice === 'mild' ? '微辣以内' : null,
    f.staple === 'rice' ? '米饭' : f.staple === 'noodles' ? '面食' : null,
    f.taste === 'light' ? '清淡' : null].filter(Boolean).join(' · ');
}
