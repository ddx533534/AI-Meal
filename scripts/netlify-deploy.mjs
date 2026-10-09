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
const originalArgv = process.argv;
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
  const args = [process.execPath, 'netlify', 'deploy', '--prod', '--json', '--site', deployment.siteId,
    ...names.flatMap(key => ['--secret-env', `${key}=${secrets[key]}`]),
    '--env', 'GEMINI_MODEL=gemini-3.1-flash-lite'];
  // CLI command-helpers snapshots process.argv when imported. Explicit
  // runProgram arguments alone do not enable its JSON output.
  process.argv = args;
  const { createMainCommand } = await import('../node_modules/netlify-cli/dist/commands/main.js');
  const { runProgram } = await import('../node_modules/netlify-cli/dist/utils/run-program.js');
  const program = createMainCommand();
  try {
    await runProgram(program, args);
  } catch (error) {
    if (error.name !== 'CliExit' || error.code !== 0) throw error;
  }
  await program.onEnd();
  // JSON mode returns one public result object. Build messages may precede it.
  // CLI build progress can follow a JSON object. Parse balanced objects and
  // accept only the public deploy result for this exact linked site.
  let result;
  for (let start = 0; start < output.length; start++) {
    if (output[start] !== '{') continue;
    let depth = 0, quoted = false, escaped = false;
    for (let end = start; end < output.length; end++) {
      const char = output[end];
      if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
      if (char === '"') quoted = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try { const candidate = JSON.parse(output.slice(start, end + 1)); if (candidate.site_id === deployment.siteId && candidate.deploy_id) result = candidate; } catch { /* Progress is not necessarily JSON. */ }
        start = end; break;
      }
    }
  }
  if (!result) throw new Error('PUBLIC_DEPLOY_RESULT_MISSING');
  if (result.site_id !== deployment.siteId || !result.deploy_id) throw new Error('Unexpected deployment result.');
  const safe = Object.fromEntries(['site_id', 'site_name', 'deploy_id', 'deploy_url', 'url', 'logs', 'function_logs', 'edge_function_logs'].filter(key => result[key] !== undefined).map(key => [key, result[key]]));
  await mkdir('verification', { recursive: true });
  await writeFile('verification/netlify-deploy.local.json', JSON.stringify(safe, null, 2) + '\n');
  // A new deployment has not passed the previous deployment's cloud checks.
  const { cloudVerifiedAt, cloudVerification, deployState, publishedAt, ...configuration } = deployment;
  await writeFile('deployment-netlify.json', JSON.stringify({ ...configuration, deployId: result.deploy_id, deployedAt: new Date().toISOString(), secretConfiguration: 'deploy-only Functions variables' }, null, 2) + '\n');
  originalOut(JSON.stringify({ ...safe, configured: names, scope: 'functions', deployOnly: true }, null, 2) + '\n');
} catch (error) {
  const failureText = `${error.message ?? ''}\n${output}`;
  const diagnostics = ['PUBLIC_DEPLOY_RESULT_MISSING', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'fetch failed', 'Unauthorized', 'Forbidden', 'credit', 'Build failed', 'Failed to deploy', 'Unexpected deployment'].filter(marker => failureText.toLowerCase().includes(marker.toLowerCase()));
  // Only fixed diagnostic markers are public; the CLI may include credentials
  // in verbose errors, so do not expose its raw text or upstream response body.
  originalErr(JSON.stringify({ operation: 'Netlify deploy', failed: true, errorType: error.name, status: typeof error.status === 'number' ? error.status : undefined }) + '\n');
  originalErr(JSON.stringify({ diagnostics }) + '\n');
  process.exitCode = 1;
} finally {
  process.stdout.write = originalOut;
  process.stderr.write = originalErr;
  process.exit = originalExit;
  process.argv = originalArgv;
}
