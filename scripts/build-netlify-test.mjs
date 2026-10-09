import { build } from 'esbuild';

await build({
  stdin: {
    contents: "export { default as api, config } from './netlify/functions/api'; export { createRecordStore } from './src/netlify-store'; export { handleRequest } from './src/api'; export { createMealSessionStore } from './src/meal-picker/store'; export { buildA2ui, formData } from './src/meal-picker/a2ui'; export { queryMeals, emptyFilters } from './src/meal-picker/menu'; export { createFoodStore } from './src/meal-picker/foods'; export { createMenuMcp } from './src/meal-picker/mcp';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: '.netlify/test-runtime.mjs',
});
