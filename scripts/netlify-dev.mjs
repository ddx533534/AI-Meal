import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { spawn } from 'node:child_process';

const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
// This project only has Node Functions. In this local environment the CLI's
// unused Deno Edge proxy hangs even static requests; bypass it for development.
const child = spawn(process.execPath, ['node_modules/netlify-cli/bin/run.js', 'dev', '--internal-disable-edge-functions', '--no-open', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ...secrets, GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite' },
});
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
