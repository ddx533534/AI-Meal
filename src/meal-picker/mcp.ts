import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod/v3';
import { filtersSchema, queryMeals, type Meal } from './menu';

export interface ToolEvidence { name: string; arguments: unknown; result: unknown }
export async function createMenuMcp(menu: readonly Meal[] = []) {
  const server = new McpServer({ name: 'ai-meal-saved-foods', version: '1.0.0' });
  server.registerTool('query_meals', {
    description: '按全部明确条件筛选已录入菜单，提供真实候选和预算调整统计。',
    inputSchema: { filters: filtersSchema, page: z.number().int().min(0).max(10000) },
  }, async ({ filters, page }) => ({ content: [{ type: 'text', text: JSON.stringify(queryMeals(filters, page, menu)) }] }));
  server.registerTool('get_meal', {
    description: '按 ID 获取已录入菜单中的实际餐食。', inputSchema: { id: z.string().max(64) },
  }, async ({ id }) => ({ content: [{ type: 'text', text: JSON.stringify({ meal: menu.find(m => m.id === id) ?? null }) }] }));
  const client = new Client({ name: 'ai-meal-adk', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const discovery = await client.listTools();
  if (discovery.tools.length !== 2) throw new Error('MCP_DISCOVERY_FAILED');
  const evidence: ToolEvidence[] = [];
  return {
    discovery: discovery.tools.map(t => t.name), evidence,
    async call<T>(name: 'query_meals' | 'get_meal', args: Record<string, unknown>): Promise<T> {
      const response = await client.callTool({ name, arguments: args });
      if (response.isError) throw new Error('MCP_TOOL_FAILED');
      const content = response.content as Array<{ type: string; text?: string }>;
      const result: T = JSON.parse(content.filter(p => p.type === 'text').map(p => p.text ?? '').join(''));
      evidence.push({ name, arguments: args, result });
      return result;
    },
    async close() { await Promise.allSettled([client.close(), server.close()]); },
  };
}
