import type { Config } from '@netlify/functions';
import { handleRequest } from '../../src/api';
import { createRecordStore } from '../../src/netlify-store';
import { handleMealPicker } from '../../src/meal-picker/api';

export default async function api(request: Request): Promise<Response> {
  if (new URL(request.url).pathname.startsWith('/api/meal-picker/')) {
    return handleMealPicker(request, {
      GEMINI_API_KEY: process.env.GEMINI_API_KEY,
      API_AUTH_TOKEN: process.env.API_AUTH_TOKEN,
      GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
    });
  }
  return handleRequest(request, {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    API_AUTH_TOKEN: process.env.API_AUTH_TOKEN,
    GEMINI_MODEL: process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite',
    records: createRecordStore(),
  });
}

export const config: Config = {
  path: ['/health', '/api/*'],
};
