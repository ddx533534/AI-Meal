import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Reuse the official CLI's SDK and credential store; never print credentials.
const cliRequire = createRequire(new URL('../node_modules/netlify-cli/package.json', import.meta.url));
const { NetlifyAPI } = await import(pathToFileURL(cliRequire.resolve('@netlify/api')).href);
const { getGlobalConfigStore } = await import(pathToFileURL(cliRequire.resolve('@netlify/dev-utils')).href);
const config = await getGlobalConfigStore();
const userId = config.get('userId');
const token = process.env.NETLIFY_AUTH_TOKEN ?? config.get(`users.${userId}.auth.token`);
if (!token) throw new Error('Complete Netlify CLI authorization first.');
const api = new NetlifyAPI(token);
let stage = 'site metadata';

try {
  const { siteId } = JSON.parse(await readFile('.netlify/state.json', 'utf8'));
  if (!siteId) throw new Error('No linked site.');
  const site = await api.getSite({ siteId });
  if (site.account_slug !== 'dream533534') throw new Error('Unexpected Netlify team.');
  let previous = {};
  try { previous = JSON.parse(await readFile('deployment-netlify.json', 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sameDeploy = previous.deployId === site.published_deploy?.id;
  const deployment = {
    provider: 'netlify', siteId: site.id, name: site.name,
    url: site.ssl_url ?? site.url, accountSlug: site.account_slug,
    storage: 'Netlify Blobs', storeName: 'ai-meal-records',
    ...(site.published_deploy ? { deployId: site.published_deploy.id, deployState: site.published_deploy.state, publishedAt: site.published_deploy.published_at } : {}),
    ...(sameDeploy ? Object.fromEntries(['productionVisibility', 'deployPreviewVisibility', 'secretConfiguration', 'cloudVerifiedAt', 'cloudVerification'].filter(key => previous[key] !== undefined).map(key => [key, previous[key]])) : {}),
  };
  const url = new URL(deployment.url);
  if (url.protocol !== 'https:' || !/^[a-z0-9-]+\.netlify\.app$/.test(url.hostname)) throw new Error('Unexpected deployment URL.');
  await writeFile('deployment-netlify.json', JSON.stringify(deployment, null, 2) + '\n');
  console.log(JSON.stringify({ ...deployment, sso_login: site.sso_login, functions_region: site.functions_region }));
} catch (error) {
  // SDK errors can contain sensitive response bodies. Return only safe status.
  console.error(JSON.stringify({ operation: 'Netlify settings', stage, failed: true, status: typeof error.status === 'number' ? error.status : undefined, errorType: error.name }));
  process.exitCode = 1;
}
