import { Ajv2020 } from 'ajv/dist/2020.js';
import common from './schema/common_types.json';
import catalog from './schema/catalog.json';
import serverSchema from './schema/server_to_client.json';
import { mealStep, filterSummary } from './flow';
import type { Filters, Meal, QueryResult } from './menu';

const ajv = new Ajv2020({ strict: false, validateFormats: false });
ajv.addSchema(common);
ajv.addSchema(catalog, 'https://a2ui.org/specification/v0_9/catalog.json');
const validate = ajv.compile(serverSchema);
export const catalogId = catalog.catalogId;
export const surfaceId = 'meal-picker';
type Component = Record<string, unknown> & { id: string; component: string };

export function formData(f: Filters) {
  return { meal: f.meal ? [f.meal] : [], budget: [f.budget === null ? 'any' : [20, 30, 40].includes(f.budget) ? String(f.budget) : 'custom'],
    customBudget: f.budget === null ? '' : String(f.budget), spice: [f.spice], staple: [f.staple], taste: [f.taste] };
}
export function buildA2ui(filters: Filters, result?: QueryResult, selected?: Meal | null, more = false, editing = false) {
  const components: Component[] = [];
  const root: string[] = [];
  const add = (component: Component, top = true) => { components.push(component); if (top) root.push(component.id); return component.id; };
  const text = (id: string, value: string, top = true, variant = 'body') => add({ id, component: 'Text', text: value, variant }, top);
  const button = (id: string, label: string, name: string, context: Record<string, unknown> = {}, top = true) => {
    text(`${id}-label`, label, false);
    return add({ id, component: 'Button', child: `${id}-label`, variant: ['update', 'choose_meal', 'adjust_budget', 'restart'].includes(name) ? 'primary' : ['toggle_more', 'select', 'rotate', 'edit_filters'].includes(name) ? 'borderless' : 'default', action: { event: { name, context } } }, top);
  };
  const choice = (id: string, label: string, options: Array<[string, string]>, top = true) => add({ id, component: 'ChoicePicker', label, displayStyle: 'chips', variant: 'mutuallyExclusive', options: options.map(([value, label]) => ({ value, label })), value: { path: `/form/${id}` } }, top);
  const step = mealStep(filters, result, selected, editing);
  if (step === 'editing') {
    text('intro', '改一下条件', true, 'h5');
    choice('meal', '餐别', [['lunch', '午饭'], ['dinner', '晚饭']]);
    choice('budget', '预算上限', [['20', '¥20'], ['30', '¥30'], ['40', '¥40'], ['any', '不限'], ['custom', '自定义']]);
    add({ id: 'custom-budget', component: 'TextField', label: '自定义预算（元）', variant: 'number', value: { path: '/form/customBudget' } });
    choice('spice', '辣度', [['none', '不辣'], ['mild', '微辣以内'], ['any', '不限']]);
    button('more', more ? '收起更多偏好' : '更多偏好', 'toggle_more', {}, false);
    choice('staple', '主食', [['any', '不限'], ['rice', '米饭'], ['noodles', '面食']], false);
    choice('taste', '口味', [['any', '不限'], ['light', '清淡']], false);
    add({ id: 'more-options', component: 'Column', children: ['staple', 'taste'] }, more);
    button('update', '按这些条件找', 'update', { form: { path: '/form' } }, false);
    components.find(component => component.id === 'update')!.weight = 1;
    add({ id: 'filter-actions', component: 'Row', children: ['more', 'update'], align: 'center' });
  } else if (step === 'start' || step === 'need_meal') {
    text('intro', step === 'start' ? '也可以先选餐别' : '这次是午饭，还是晚饭？', true, 'h5');
    if (step === 'need_meal') {
      text('summary', `已记住：${filterSummary(filters)}`, true, 'caption');
      text('meal-hint', '选好餐别，我就按这些条件查你的菜单。');
    }
    const lunch = button('choose-lunch', '午饭', 'choose_meal', { meal: 'lunch' }, false);
    const dinner = button('choose-dinner', '晚饭', 'choose_meal', { meal: 'dinner' }, false);
    for (const id of [lunch, dinner]) components.find(component => component.id === id)!.weight = 1;
    add({ id: 'meal-question', component: 'Row', children: [lunch, dinner] });
    if (step === 'start') button('edit', '自己设条件', 'edit_filters');
  } else if (step === 'selected' && selected) {
    text('confirmed', '本次选择', true, 'h5');
    const name = add({ id: 'confirmed-name', component: 'Text', text: selected.name, variant: 'h5', weight: 1 }, false);
    const price = text('confirmed-price', `¥${selected.price}`, false, 'h4');
    const row = add({ id: 'confirmed-row', component: 'Row', children: [name, price], justify: 'spaceBetween', align: 'center' }, false);
    const note = text('confirm-note', `${filterSummary(filters)} · 已确认`, false, 'caption');
    const body = add({ id: 'confirmed-body', component: 'Column', children: [row, note] }, false);
    add({ id: 'confirmed-card', component: 'Card', child: body });
    button('restart', '再选一餐', 'restart');
  } else if (result) {
    text('summary', filterSummary(filters), true, 'caption');
    if (step === 'no_match') {
      text('result-title', '没有符合条件的选项', true, 'h5');
      text('reason', result.reason ?? '当前条件组合没有匹配。');
      const hasOptions = Boolean(result.adjustment || result.alternatives?.length);
      text('next-hint', hasOptions ? '可以这样调整，其他条件会保留：' : '暂时没有只改一项就能匹配的方案。你可以自己改条件，或在“我的食物”中录入餐食。', true, 'caption');
      if (result.adjustment) button('adjust', `预算调到 ¥${result.adjustment.budget} · ${result.adjustment.count} 份可选`, 'adjust_budget', { budget: result.adjustment.budget });
      for (const alternative of result.alternatives ?? []) {
        const label = alternative.field === 'taste' ? '放宽清淡要求' : alternative.field === 'spice' ? '辣度改为不限' : alternative.field === 'staple' ? '主食改为不限' : alternative.value === 'lunch' ? '改选午饭' : '改选晚饭';
        button(`relax-${alternative.field}`, `${label} · ${alternative.count} 份可选`, 'relax_filter', { field: alternative.field, value: alternative.value });
      }
    } else {
      text('result-title', `找到 ${result.total} 份符合条件的餐食`, true, 'h5');
      for (const meal of result.candidates) {
        const title = add({ id: `${meal.id}-title`, component: 'Text', text: meal.name, variant: 'h5', weight: 1 }, false);
        const price = text(`${meal.id}-price`, `¥${meal.price}`, false, 'h4');
        const heading = add({ id: `${meal.id}-heading`, component: 'Row', children: [title, price], justify: 'spaceBetween', align: 'center' }, false);
        const tags = add({ id: `${meal.id}-tags`, component: 'Text', text: `${meal.spice === 'none' ? '不辣' : meal.spice === 'mild' ? '微辣' : '辣'} · ${meal.staple === 'rice' ? '米饭' : meal.staple === 'noodles' ? '面食' : '其他主食'}${meal.light ? ' · 清淡' : ''}`, variant: 'caption', weight: 1 }, false);
        const pick = button(`${meal.id}-pick`, '就选这个', 'select', { id: meal.id }, false);
        const footer = add({ id: `${meal.id}-footer`, component: 'Row', children: [tags, pick], justify: 'spaceBetween', align: 'center' }, false);
        const col = add({ id: `${meal.id}-body`, component: 'Column', children: [heading, footer] }, false);
        add({ id: meal.id, component: 'Card', child: col });
      }
      if (result.pages > 1) button('rotate', '换一批', 'rotate');
      else text('rotation-note', '符合条件的餐食都在这里了', true, 'caption');
    }
    button('edit', '改一下条件', 'edit_filters');
  }
  components.push({ id: 'root', component: 'Column', children: root });
  const messages = [
    { version: 'v0.9.1', createSurface: { surfaceId, catalogId, sendDataModel: true } },
    { version: 'v0.9.1', updateDataModel: { surfaceId, path: '/', value: { form: formData(filters) } } },
    { version: 'v0.9.1', updateComponents: { surfaceId, components } },
  ];
  for (const message of messages) if (!validate(message)) throw new Error('A2UI_SCHEMA_INVALID');
  return messages;
}
