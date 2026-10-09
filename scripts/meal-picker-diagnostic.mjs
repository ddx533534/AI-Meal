import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

// Read credentials in memory and send curl configuration over stdin.
const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
const deployment = JSON.parse(await readFile('deployment-netlify.json', 'utf8'));
if (!secrets.API_AUTH_TOKEN) throw new Error('Missing service credentials');
const quote = value => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
async function request(path, method = 'GET', body) {
  const config = [`header = ${quote(`Authorization: Bearer ${secrets.API_AUTH_TOKEN}`)}`];
  if (body !== undefined) config.push('header = "Content-Type: application/json"', `data = ${quote(JSON.stringify(body))}`);
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--config', '-', '--silent', '--show-error', '--max-time', '65', '--request', method, '--write-out', '\n%{http_code}', `${deployment.url}/api/meal-picker/${path}`]);
    child.stdin.end(config.join('\n') + '\n');
    let output = '';
    child.stdout.on('data', b => { output += b; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('Transport unavailable')));
    child.on('close', code => {
      if (code !== 0) return reject(new Error('Transport failed'));
      const i = output.lastIndexOf('\n');
      let data;
      try { data = JSON.parse(output.slice(0, i)); }
      catch { data = { error: 'NON_JSON_RESPONSE' }; }
      resolve({ status: Number(output.slice(i + 1)), durationMs: Date.now() - started, data });
    });
  });
}
const report = { startedAt: new Date().toISOString(), backend: deployment.url, deployId: deployment.deployId, checks: [] };
for (const [name, body] of [
  ['bootstrap', undefined],
  ['update with unspecified meal', { filters: { meal: null, budget: null, spice: 'any', staple: 'any', taste: 'any' } }],
  ['update lunch 30 no spice', { filters: { meal: 'lunch', budget: 30, spice: 'none', staple: 'any', taste: 'any' } }],
]) {
  const r = await request(body === undefined ? 'bootstrap' : 'session', body === undefined ? 'GET' : 'POST', body);
  const check = { name, status: r.status, durationMs: r.durationMs, error: r.data.error, reason: r.data.reason, filters: r.data.session?.filters, total: r.data.session?.total };
  report.checks.push(check);
  console.log(JSON.stringify(check));
  await writeFile('verification/meal-picker-diagnostic.local.json', JSON.stringify(report, null, 2) + '\n');
  if (r.data.session?.id) {
    const cleanup = await request(`session?id=${r.data.session.id}`, 'DELETE');
    if (cleanup.status !== 200) throw new Error('Diagnostic session cleanup failed');
  }
}
report.completedAt = new Date().toISOString();
await writeFile('verification/meal-picker-diagnostic.local.json', JSON.stringify(report, null, 2) + '\n');
