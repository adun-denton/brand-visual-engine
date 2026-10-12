import { resolve } from 'node:path';
import { chatTools } from './chat-contracts.ts';

// Only these existing, grant-bound actions may pass the MCP permission layer.
// Undeclared tools remain excluded and require approval under global `never`.
export function bveMcpConfig(origin: string, grant: string) {
  return {
    bve: {
      command: process.execPath,
      args: [resolve(import.meta.dirname, '../../scripts/chat-mcp.ts')],
      env: { BVE_CHAT_ORIGIN: origin, BVE_CHAT_GRANT: grant },
      required: true,
      enabled_tools: [...chatTools],
      default_tools_approval_mode: 'prompt',
      tools: Object.fromEntries(chatTools.map(name => [name, { approval_mode: 'approve' }])),
    },
  };
}
