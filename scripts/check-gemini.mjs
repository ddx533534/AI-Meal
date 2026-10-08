import { readFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';

const secrets = parseEnv(await readFile('.dev.vars', 'utf8'));
if (!secrets.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');
try {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=100', {
    headers: { 'x-goog-api-key': secrets.GEMINI_API_KEY },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json();
  const status = payload.error?.status;
  const knownStatus = ['INVALID_ARGUMENT', 'UNAUTHENTICATED', 'PERMISSION_DENIED', 'NOT_FOUND', 'RESOURCE_EXHAUSTED', 'INTERNAL', 'UNAVAILABLE'];
  console.log(JSON.stringify({
    operation: 'Gemini listModels',
    httpStatus: response.status,
    providerStatus: knownStatus.includes(status) ? status : undefined,
    generationModels: response.ok ? (payload.models ?? [])
      .filter((model) => model.supportedGenerationMethods?.includes('generateContent'))
      .map((model) => model.name.replace(/^models\//, '')) : undefined,
  }, null, 2));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ operation: 'Gemini listModels',
    errorType: error.name,
    networkCode: error.cause?.code,
  }, null, 2));
  process.exitCode = 1;
}
