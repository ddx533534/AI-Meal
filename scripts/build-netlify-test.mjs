import { build } from 'esbuild';

await build({
  stdin: {
    contents: "export { default as api, config } from './netlify/functions/api'; export { createRecordStore } from './src/netlify-store'; export { handleRequest } from './src/api';",
    resolveDir: process.cwd(),
    loader: 'ts',
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile: '.netlify/test-runtime.mjs',
});
