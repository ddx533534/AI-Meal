import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const deployment = JSON.parse(await readFile('deployment-netlify.json', 'utf8'));
const state = JSON.parse(await readFile('.netlify/state.json', 'utf8'));
if (state.siteId !== deployment.siteId || deployment.siteId !== '2e2e8d1b-8a95-4cb6-9147-0676c1d68a3c' || deployment.accountSlug !== 'dream533534') {
  throw new Error('Unexpected deployment destination.');
}
const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
const names = ['GEMINI_API_KEY', 'API_AUTH_TOKEN'];
for (const key of names) if (!secrets[key]?.trim()) throw new Error(`Missing ${key}.`);

// The official CLI supports deploy-only Functions variables. Pass its parser
// an in-memory argument array, so credentials never appear in OS process args.
// Keep raw CLI output private in memory and emit only its public deploy fields.
let output = '';
const originalOut = process.stdout.write.bind(process.stdout);
const originalErr = process.stderr.write.bind(process.stderr);
const originalExit = process.exit;
const capture = (chunk, encoding, callback) => {
  output += typeof chunk === 'string' ? chunk : chunk.toString();
  if (typeof encoding === 'function') encoding();
  else if (typeof callback === 'function') callback();
  return true;
};
process.stdout.write = capture;
process.stderr.write = capture;
// JSON-mode CLI exits after printing its result. Convert that exit into a
// private signal so the wrapper can persist the result and restore output.
process.exit = code => { throw Object.assign(new Error('CLI exit'), { name: 'CliExit', code: Number(code ?? 0) }); };
try {
  const { createMainCommand } = await import('../node_modules/netlify-cli/dist/commands/main.js');
  const { runProgram } = await import('../node_modules/netlify-cli/dist/utils/run-program.js');
  const program = createMainCommand();
  const args = [process.execPath, 'netlify', 'deploy', '--prod', '--json', '--site', deployment.siteId,
    ...names.flatMap(key => ['--secret-env', `${key}=${secrets[key]}`]),
    '--env', 'GEMINI_MODEL=gemini-3.1-flash-lite'];
  try {
    await runProgram(program, args);
  } catch (error) {
    if (error.name !== 'CliExit' || error.code !== 0) throw error;
  }
  await program.onEnd();
  // JSON mode returns one public result object. Build messages may precede it.
  const start = output.lastIndexOf('\n{');
  const result = JSON.parse(output.slice(start >= 0 ? start + 1 : output.indexOf('{')));
  if (result.site_id !== deployment.siteId || !result.deploy_id) throw new Error('Unexpected deployment result.');
  const safe = Object.fromEntries(['site_id', 'site_name', 'deploy_id', 'deploy_url', 'url', 'logs', 'function_logs', 'edge_function_logs'].filter(key => result[key] !== undefined).map(key => [key, result[key]]));
  await mkdir('verification', { recursive: true });
  await writeFile('verification/netlify-deploy.local.json', JSON.stringify(safe, null, 2) + '\n');
  // A new deployment has not passed the previous deployment's cloud checks.
  const { cloudVerifiedAt, cloudVerification, deployState, publishedAt, ...configuration } = deployment;
  await writeFile('deployment-netlify.json', JSON.stringify({ ...configuration, deployId: result.deploy_id, deployedAt: new Date().toISOString(), secretConfiguration: 'deploy-only Functions variables' }, null, 2) + '\n');
  originalOut(JSON.stringify({ ...safe, configured: names, scope: 'functions', deployOnly: true }, null, 2) + '\n');
} catch (error) {
  originalErr(JSON.stringify({ operation: 'Netlify deploy', failed: true, errorType: error.name, status: typeof error.status === 'number' ? error.status : undefined }) + '\n');
  process.exitCode = 1;
} finally {
  process.stdout.write = originalOut;
  process.stderr.write = originalErr;
  process.exit = originalExit;
}
