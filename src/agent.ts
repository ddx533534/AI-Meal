// The explicit web entry avoids ADK's Node-only integrations in Workers.
import {
  Gemini,
  InMemorySessionService,
  LlmAgent,
  Runner,
  isFinalResponse,
  setLogger,
} from '@google/adk/dist/web/index_web.js';

// Keep prompts and upstream error details out of runtime logs.
setLogger(null);

export class ModelInvocationError extends Error {
  constructor(readonly reason: string) {
    super('Model invocation failed');
  }
}

function failureReason(error: unknown): string {
  if (error instanceof ModelInvocationError) return error.reason;
  if (typeof error !== 'object' || error === null) return 'UNKNOWN';
  if ('status' in error && typeof error.status === 'number' && error.status >= 400 && error.status <= 599) {
    return `UPSTREAM_HTTP_${error.status}`;
  }
  if ('name' in error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'TIMEOUT';
  if ('name' in error && error.name === 'TypeError') return 'NETWORK_OR_RUNTIME';
  return 'UNKNOWN';
}

export async function analyze(input: string, apiKey: string, model: string): Promise<string> {
  const sessionService = new InMemorySessionService();
  const appName = 'ai_meal_verification';
  const userId = 'verification';
  const agent = new LlmAgent({
    name: 'meal_assistant',
    model: new Gemini({ model, apiKey, vertexai: false }),
    instruction:
      '用中文简要整理用户提供的饮食信息。只依据输入作答，缺失的信息应明确指出；' +
      '不得虚构食物重量、热量或营养数值。此接口用于验证模型调用和记录保存。',
    generateContentConfig: {
      maxOutputTokens: 512,
      httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } },
    },
  });
  const session = await sessionService.createSession({ appName, userId });
  const runner = new Runner({ appName, agent, sessionService });
  let output = '';
  try {
    for await (const event of runner.runAsync({
      userId,
      sessionId: session.id,
      newMessage: { role: 'user', parts: [{ text: input }] },
      abortSignal: AbortSignal.timeout(30_000),
      runConfig: { maxLlmCalls: 1 },
    })) {
      if (event.errorCode) {
        const code = /^[A-Z0-9_]{1,64}$/.test(event.errorCode) ? event.errorCode : 'UNKNOWN';
        throw new ModelInvocationError(`MODEL_${code}`);
      }
      if (event.finishReason === 'MAX_TOKENS') throw new ModelInvocationError('OUTPUT_LIMIT_REACHED');
      if (isFinalResponse(event)) {
        output = (event.content?.parts ?? [])
          .filter((part) => !part.thought)
          .map((part) => part.text ?? '')
          .join('')
          .trim();
      }
    }
  } catch (error) {
    throw new ModelInvocationError(failureReason(error));
  } finally {
    await sessionService.deleteSession({ appName, userId, sessionId: session.id });
  }
  if (!output) throw new ModelInvocationError('NO_FINAL_TEXT');
  return output;
}
