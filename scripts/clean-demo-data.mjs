import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { getStore } from '@netlify/blobs';

const apply = process.argv.includes('--apply');
const cliRequire = createRequire(new URL('../node_modules/netlify-cli/package.json', import.meta.url));
const { getGlobalConfigStore } = await import(pathToFileURL(cliRequire.resolve('@netlify/dev-utils')).href);
const config = await getGlobalConfigStore();
const token = process.env.NETLIFY_AUTH_TOKEN ?? config.get(`users.${config.get('userId')}.auth.token`);
const deployment = JSON.parse(await readFile('deployment-netlify.json', 'utf8'));
if (deployment.siteId !== '2e2e8d1b-8a95-4cb6-9147-0676c1d68a3c' || !token) throw new Error('Unexpected site or missing authorization');
const quote = s => '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
async function transport(input, options) {
  const req = new Request(input, options);
  const url = new URL(req.url);
  if (url.protocol !== 'https:' || !(/(^|\.)netlify\.(com|app)$/.test(url.hostname) || url.hostname === 'cmh-services-prod-netliblob-935421240257.s3.us-east-2.amazonaws.com')) throw Object.assign(new Error('Unexpected storage host'), { safeHost: url.hostname });
  const lines = [...req.headers].map(([k, v]) => `header = ${quote(`${k}: ${v}`)}`);
  if (!['GET', 'HEAD'].includes(req.method)) lines.push(`data = ${quote(await req.text())}`);
  return new Promise((resolve, reject) => {
    const child = spawn('curl', ['--config', '-', '--silent', '--show-error', '--max-time', '40', '--request', req.method, '--write-out', '\n%{http_code}', req.url]);
    child.stdin.end(lines.join('\n') + '\n');
    let output = ''; child.stdout.on('data', b => { output += b; }); child.stderr.resume();
    child.on('error', () => reject(new Error('Storage transport unavailable')));
    child.on('close', code => { if (code) return reject(new Error('Storage transport failed')); const index = output.lastIndexOf('\n'); const status = Number(output.slice(index + 1)); resolve(new Response([204, 304].includes(status) ? null : output.slice(0, index), { status })); });
  });
}
const proofIds = new Set();
for (const file of await readdir('verification')) {
  if (!file.endsWith('.json')) continue;
  try { const report = JSON.parse(await readFile(`verification/${file}`, 'utf8')); if (report.record?.id) proofIds.add(report.record.id); } catch { /* Non-report files supply no evidence. */ }
}
const report = { mode: apply ? 'delete identified synthetic data' : 'inventory only', at: new Date().toISOString(), stores: [] };
try {
  for (const name of ['ai-meal-picker-sessions', 'ai-meal-records', 'ai-meal-foods']) {
    const store = getStore({ name, siteID: deployment.siteId, token, consistency: 'strong', fetch: transport });
    const keys = []; for await (const page of store.list({ paginate: true })) keys.push(...page.blobs.map(b => b.key));
    const identified = []; let preserved = 0;
    for (const key of keys) {
      const data = await store.get(key, { type: 'json' });
      let reason;
      if (name === 'ai-meal-picker-sessions' && (data?.result?.source === 'demo-menu' || data?.result?.candidates?.some(m => /^demo-\d+$/.test(m.id)) || /^demo-\d+$/.test(data?.selected?.id ?? ''))) reason = 'legacy demo menu session';
      if (name === 'ai-meal-records' && (proofIds.has(data?.id) || data?.input === '云端验证：早餐吃了一个鸡蛋和一片面包，重量和配料未知。请只整理已知信息并指出缺失信息。')) reason = 'record identified by saved verification report or exact smoke-test input';
      if (reason) { identified.push({ key, reason }); if (apply) await store.delete(key); } else preserved++;
    }
    const remaining = []; for await (const page of store.list({ paginate: true })) remaining.push(...page.blobs.map(b => b.key));
    report.stores.push({ name, before: keys.length, identified, deleted: apply ? identified.length : 0, preserved, after: remaining.length });
    console.log(JSON.stringify({ name, before: keys.length, identified: identified.length, deleted: apply ? identified.length : 0, preserved, after: remaining.length }));
  }
  report.status = 'passed';
} catch (e) { report.status = 'failed'; report.failureType = e.name; if (e.safeHost) report.safeHost = e.safeHost; console.error('Storage inspection failed; see safe report status'); process.exitCode = 1; }
await writeFile(`verification/meal-foods-20261009/${apply ? 'cleanup' : 'inventory'}.local.json`, JSON.stringify(report, null, 2) + '\n');
