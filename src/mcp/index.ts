import readline from 'node:readline';
import { tools } from './tools';
import { ToolError } from '../types';

// Build lookup map
const toolMap = new Map<string, (typeof tools)[0]>(tools.map((t) => [t.name, t]));

interface IncomingMessage {
  id?: string | number;
  tool: string;
  args?: unknown;
}
interface OutgoingMessage {
  id?: string | number;
  result?: unknown;
  error?: { message: string };
}

async function processMessage(msg: IncomingMessage): Promise<OutgoingMessage> {
  const toolDef = toolMap.get(msg.tool);
  if (!toolDef) {
    return { id: msg.id, error: { message: `Unknown tool: ${msg.tool}` } };
  }
  try {
    const input = toolDef.inputSchema.parse(msg.args);
    const result = await toolDef.execute(input as any);
    // Validate output if schema defined
    if (toolDef.outputSchema) {
      toolDef.outputSchema.parse(result);
    }
    return { id: msg.id, result };
  } catch (err: any) {
    let message = 'Unknown error';
    if (err instanceof ToolError || err instanceof Error) {
      message = err.message;
    }
    return { id: msg.id, error: { message } };
  }
}

function startStdIOServer() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });
  rl.on('line', async (line) => {
    line = line.trim();
    if (line.length === 0) return;
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      const errorResp: OutgoingMessage = { error: { message: 'Failed to parse input as JSON' } };
      process.stdout.write(JSON.stringify(errorResp) + '\n');
      return;
    }
    const resp = await processMessage(msg);
    process.stdout.write(JSON.stringify(resp) + '\n');
  });
}

if (require.main === module) {
  startStdIOServer();
}