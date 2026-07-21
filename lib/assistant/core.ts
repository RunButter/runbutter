// Shared chat-assistant core. Every platform webhook (Telegram/Slack/WhatsApp)
// resolves its channel, authorises the sender, then calls this with the message
// text — it runs the workspace agent loop on the workspace's own AI key and
// returns a plain-text reply to send back. Server-only.

import { openSecret } from '@/lib/crypto/secrets';
import { PROVIDERS, type AIProvider } from '@/lib/ai/providers';
import { runAgent, type AgentDef } from '@/lib/agents/runner';

export interface AssistantChannel {
  id: string; workspace_id: string; platform: string; bot_token: string | null;
  webhook_secret: string; allowed_senders: string[]; autonomy: 'suggest' | 'auto';
  acting_privy: string | null; enabled: boolean;
}

const defaultModel = (p: string) => PROVIDERS.find((x) => x.id === p)?.models[0] || '';

// A sender is authorised if their id (or @username) is on the channel allowlist.
// Empty allowlist = nobody (fail closed) — the owner must add ids explicitly.
export function senderAllowed(channel: AssistantChannel, ...ids: (string | number | null | undefined)[]): boolean {
  const allow = (channel.allowed_senders || []).map((s) => s.trim().toLowerCase().replace(/^@/, ''));
  if (!allow.length) return false;
  return ids.some((id) => id != null && allow.includes(String(id).trim().toLowerCase().replace(/^@/, '')));
}

export async function runAssistant(admin: any, channel: AssistantChannel, message: string): Promise<string> {
  const msg = (message || '').trim().slice(0, 4000);
  if (!msg) return 'Send me a message — e.g. “create an offer for Acme at 12,000” or “how many open deals do we have?”';
  if (!channel.acting_privy) return 'This assistant isn’t fully set up yet. Reconnect it from RunButter → Assistant.';

  // BYO AI key for the workspace (also validates the acting user's membership).
  const { data: secret, error } = await admin.rpc('get_ai_secret', {
    p_privy: channel.acting_privy, p_workspace: channel.workspace_id,
  });
  if (error || !secret) {
    return 'I can’t respond yet — no AI key is set for this workspace. Add one in RunButter → Settings → AI keys.';
  }

  let apiKey: string;
  try { apiKey = openSecret((secret as any).cipher, (secret as any).iv, (secret as any).tag); }
  catch { return 'I couldn’t read this workspace’s AI key. Re-add it in Settings → AI keys.'; }

  const provider = (secret as any).provider as AIProvider;
  const model = (secret as any).model || defaultModel(provider);
  const baseUrl = (secret as any).base_url || undefined;

  const agent: AgentDef = {
    id: 'assistant', name: 'RunButter Assistant', role: 'operations assistant',
    instructions:
      'You are chatting with a team member over a messaging app. Keep replies short and plain-text (no markdown tables). ' +
      'Use the tools to answer questions and take actions on their workspace. When asked to create something (an offer, invoice, ' +
      'person, deal…), call create_record on the right object, then confirm what you created with its key details (name/number, ' +
      'amount, status). If a request is ambiguous, ask one brief clarifying question instead of guessing.',
    provider, model,
    allowed_tools: ['list_objects', 'list_records', 'search_records', 'get_record', 'create_record', 'update_record'],
    allowed_objects: [],
    autonomy: channel.autonomy,       // 'auto' executes writes; 'suggest' is effectively read-only in chat
    max_steps: 10,
  };

  const ctx = { admin, workspace: channel.workspace_id, privy: channel.acting_privy };
  try {
    const outcome = await runAgent(ctx, agent, provider, apiKey, model, baseUrl, msg);
    if (channel.autonomy === 'suggest' && outcome.proposed?.length) {
      return (outcome.result || '') + `\n\n(This assistant is in read-only mode, so I didn’t make those ${outcome.proposed.length} change(s). Switch it to “can make changes” in RunButter to let me act.)`;
    }
    return outcome.result || 'Done.';
  } catch (e: any) {
    return 'Something went wrong handling that: ' + (e?.message || 'unknown error');
  }
}
