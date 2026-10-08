// Optional Node preload for local transport diagnosis. Never log URLs, headers,
// prompts, response bodies, keys, or exception messages.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname !== 'generativelanguage.googleapis.com') return nativeFetch(input, options);
  try {
    const response = await nativeFetch(input, options);
    console.log(JSON.stringify({ diagnostic: 'Gemini transport', status: response.status }));
    return response;
  } catch (error) {
    console.log(JSON.stringify({ diagnostic: 'Gemini transport', errorType: error.name, networkCode: typeof error.cause?.code === 'string' && /^[A-Z0-9_]+$/.test(error.cause.code) ? error.cause.code : undefined }));
    throw error;
  }
};
