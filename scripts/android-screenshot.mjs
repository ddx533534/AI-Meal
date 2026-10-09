import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const [device, name, directory] = process.argv.slice(2);
const physicalAuthorized = process.argv.includes('--physical-authorized');
if ((!device?.startsWith('emulator-') && !(physicalAuthorized && /^[A-Za-z0-9_-]+$/.test(device || ''))) || !/^[a-z0-9-]+$/.test(name || '') || !directory) throw new Error('Expected emulator ID or explicitly authorized physical device, evidence name and output directory');
await mkdir(directory, { recursive: true });
const path = join(directory, `${name}.png`);
const screenshot = spawnSync(process.env.ADB || '/Users/dudongxu/Library/Android/sdk/platform-tools/adb', ['-s', device, 'exec-out', 'screencap', '-p'], { timeout: 15000 });
if (screenshot.status !== 0 || !screenshot.stdout.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('SCREENSHOT_INVALID');
await writeFile(path, screenshot.stdout);
const ocr = spawnSync(process.env.OCR_PYTHON || '/Users/dudongxu/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3.12', [process.env.OCR_SCRIPT || '/Users/dudongxu/.codex/skills/verification-workflow/scripts/ocr_tap.py', 'list', '--screenshot', path, '--no-server'], { encoding: 'utf8', timeout: 60000, env: { ...process.env, PYTHONPATH: process.env.OCR_PYTHONPATH || '/Users/dudongxu/.codex/shared/android-adb-ocr-paddleocr-venv/lib/python3.12/site-packages', PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK: 'True' }, maxBuffer: 5 * 1024 * 1024 });
await writeFile(join(directory, `${name}.ocr.log`), ocr.stdout + ocr.stderr);
if (ocr.status !== 0) throw new Error('OCR_COMMAND_FAILED');
let items;
for (let start = 0; start < ocr.stdout.length; start++) {
  if (ocr.stdout[start] !== '[') continue;
  try { const candidate = JSON.parse(ocr.stdout.slice(start).trim()); if (Array.isArray(candidate) && candidate.every(v => typeof v.text === 'string' && typeof v.score === 'number')) { items = candidate; break; } } catch { /* Model initialization logs precede OCR data. */ }
}
if (!items) throw new Error('OCR_OUTPUT_MISSING');
await writeFile(join(directory, `${name}.ocr.json`), JSON.stringify(items, null, 2) + '\n');
console.log(JSON.stringify({ screenshot: path, texts: items.map(v => ({ text: v.text, score: v.score, center: v.center })) }, null, 2));
