// Agent runner: a bounded tool-use loop over the shared workspace tools, on the
// user's own AI key. Safety is layered:
//   • tools are scoped to the agent's allowed_tools (and allowed_objects)
//   • a per-run step cap bounds the loop
//   • 'suggest' agents never execute writes — they queue them for approval
//   • everything (each turn + tool call + result) is logged to the run
import { agentTurn, appendToolResult, type AIProvider, type ToolSpec, type AgentToolCall } from '@/lib/ai/providers';
import { TOOLS, callTool, isWriteTool, OBJECTS, type ToolCtx } from '@/lib/agents/tools';

export interface AgentDef {
  id: string; name: string; role: string; instructions: string;
  provider: string; model: string;
  allowed_tools: string[]; allowed_objects: string[];
  autonomy: 'suggest' | 'auto'; max_steps: number;
}

export interface RunOutcome {
  status: 'done' | 'error' | 'awaiting_approval';
  steps: any[];          // audit log
  proposed: any[];       // writes awaiting approval (suggest mode)
  result: string;        // final text
}

function toolSpecs(allowed: string[], allowedObjects: string[]): ToolSpec[] {
  const objectNote = allowedObjects.length
    ? ` Only these objects are permitted: ${allowedObjects.join(', ')}.`
    : '';
  return TOOLS.filter((t) => allowed.includes(t.name)).map((t) => ({
    name: t.name,
    description: t.description + (t.name !== 'list_objects' ? objectNote : ''),
    parameters: t.inputSchema,
  }));
}

export async function runAgent(ctx: ToolCtx, agent: AgentDef, provider: AIProvider, apiKey: string, model: string, baseUrl: string | undefined, task: string): Promise<RunOutcome> {
  const allowed = agent.allowed_tools?.length ? agent.allowed_tools : ['list_objects', 'list_records', 'search_records', 'get_record'];
  const specs = toolSpecs(allowed, agent.allowed_objects || []);
  const steps: any[] = [];
  const proposed: any[] = [];

  const system =
    `You are "${agent.name}"${agent.role ? `, a ${agent.role}` : ''}, an AI agent operating inside RunButter, a business workspace.\n` +
    `${agent.instructions || ''}\n\n` +
    `Work through the user's task using the provided tools. Object types: ${Object.keys(OBJECTS).join(', ')}. ` +
    `Call list_objects first if unsure of fields. When done, reply with a short plain-text summary of what you found or did.` +
    (agent.autonomy === 'suggest'
      ? ` You are in SUGGEST mode: your create/update calls are NOT executed — they are recorded as proposals for a human to approve. Still call them to propose changes, then summarise what you proposed.`
      : ` You are in AUTO mode: create/update calls execute immediately. Be careful and precise.`);

  let history: any[] = [{ role: 'user', content: task }];
  const maxSteps = Math.max(1, Math.min(40, agent.max_steps || 12));

  for (let step = 0; step < maxSteps; step++) {
    let turn;
    try {
      turn = await agentTurn(provider, apiKey, model, system, history, specs, baseUrl);
    } catch (e: any) {
      steps.push({ type: 'error', message: e?.message || 'AI call failed' });
      return { status: 'error', steps, proposed, result: e?.message || 'AI call failed' };
    }
    history = turn.history;

    if (turn.text) steps.push({ type: 'thought', text: turn.text });

    if (!turn.toolCalls.length) {
      // model finished
      return {
        status: proposed.length ? 'awaiting_approval' : 'done',
        steps, proposed,
        result: turn.text || (proposed.length ? `Proposed ${proposed.length} change(s) for approval.` : 'Done.'),
      };
    }

    // Execute (or queue) each tool call, then feed results back.
    for (const call of turn.toolCalls) {
      const res = await handleCall(ctx, agent, call, allowed, proposed);
      steps.push({ type: 'tool', name: call.name, args: call.args, result: res });
      history = appendToolResult(provider, history, call, res);
    }
  }

  // Ran out of steps.
  return {
    status: proposed.length ? 'awaiting_approval' : 'done',
    steps, proposed,
    result: `Reached the ${maxSteps}-step limit.` + (proposed.length ? ` ${proposed.length} change(s) awaiting approval.` : ''),
  };
}

async function handleCall(ctx: ToolCtx, agent: AgentDef, call: AgentToolCall, allowed: string[], proposed: any[]): Promise<any> {
  if (!allowed.includes(call.name)) return { error: `Tool "${call.name}" is not permitted for this agent.` };
  const obj = call.args?.object;
  if (obj && agent.allowed_objects?.length && !agent.allowed_objects.includes(obj)) {
    return { error: `Object "${obj}" is not permitted for this agent.` };
  }
  if (isWriteTool(call.name)) {
    if (agent.autonomy === 'suggest') {
      proposed.push({ name: call.name, args: call.args });
      return { proposed: true, note: 'Recorded for human approval (not executed).' };
    }
    // auto mode: execute the write
  }
  try {
    return await callTool(ctx, call.name, call.args);
  } catch (e: any) {
    return { error: e?.message || 'tool failed' };
  }
}

// Execute a batch of previously-proposed writes (the approval step).
export async function executeProposed(ctx: ToolCtx, proposed: any[]): Promise<any[]> {
  const results: any[] = [];
  for (const p of proposed) {
    try { results.push({ name: p.name, args: p.args, result: await callTool(ctx, p.name, p.args) }); }
    catch (e: any) { results.push({ name: p.name, args: p.args, result: { error: e?.message || 'failed' } }); }
  }
  return results;
}
