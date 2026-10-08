import { spawn } from 'node:child_process';
import { Response } from 'miniflare';

// Diagnostic transport for this machine only. The deployed Worker never uses
// curl. Requests and responses are forwarded unchanged; no model output is mocked.
export async function curlOutbound(request) {
  const url = new URL(request.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') {
    throw new Error('Unexpected outbound host in Gemini verification');
  }
  const quote = (value) => '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"';
  const lines = [];
  for (const name of ['x-goog-api-key', 'content-type', 'x-goog-api-client']) {
    const value = request.headers.get(name);
    if (value) lines.push(`header = ${quote(`${name}: ${value}`)}`);
  }
  if (request.method === 'POST') lines.push(`data = ${quote(await request.text())}`);
  return new Promise((resolve, reject) => {
    const child = spawn('curl', [
      '--config', '-', '--silent', '--show-error', '--max-time', '35',
      '--request', request.method, '--write-out', '\n%{http_code}', request.url,
    ]);
    child.stdin.end(lines.join('\n') + '\n');
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.resume();
    child.on('error', () => reject(new Error('System transport failed to start')));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error('System transport failed'));
      const index = output.lastIndexOf('\n');
      const status = Number(output.slice(index + 1));
      const body = output.slice(0, index);
      let diagnostic = {};
      try {
        const parsed = JSON.parse(body);
        diagnostic = {
          modelVersion: parsed.modelVersion,
          providerStatus: parsed.error?.status,
          finishReason: parsed.candidates?.[0]?.finishReason,
          candidateCount: parsed.candidates?.length ?? 0,
        };
      } catch { diagnostic = { responseParsed: false }; }
      console.log(JSON.stringify({ transport: 'curl', path: url.pathname, httpStatus: status, ...diagnostic }));
      resolve(new Response(body, { status, headers: { 'content-type': 'application/json' } }));
    });
  });
}
