import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const device = value('--device');
if (!device || (!device.startsWith('emulator-') && !args.includes('--physical-authorized'))) throw new Error('Select the dedicated emulator; physical setup requires explicit user authorization and --physical-authorized');
const adb = process.env.ADB || '/Users/dudongxu/Library/Android/sdk/platform-tools/adb';
const base = ['-s', device];
const pkg = 'dev.a2ui.mealpicker';
function run(command, input) {
  const result = spawnSync(adb, [...base, ...command], { input, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error('Android test configuration command failed');
  return result.stdout;
}
const payload = {};
if (!args.includes('--clipboard-only')) {
  const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
  payload.connection = { url: value('--url') || 'https://ai-meal-adk-verification-dream533534.netlify.app', token: args.includes('--invalid-token') ? 'synthetic-invalid-token' : secrets.API_AUTH_TOKEN };
}
if (value('--text') !== undefined) payload.clipboard = value('--text');
run(['shell', 'run-as', pkg, 'mkdir', '-p', 'files']);
run(['exec-in', 'run-as', pkg, 'sh', '-c', 'cat > files/verification-input.json'], JSON.stringify(payload));
const result = run(['shell', 'am', 'instrument', '-w', `${pkg}.test/${pkg}.ConnectionSetupInstrumentation`]);
if (!result.includes('configured') || result.includes('configuration_failed')) throw new Error('Instrumentation setup failed');
console.log(JSON.stringify({ device, connectionConfigured: Boolean(payload.connection), clipboardConfigured: Boolean(payload.clipboard), credentialsLogged: false }));
