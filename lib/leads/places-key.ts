// Which Google key a search runs on: the workspace's own (0134), else the
// server's GOOGLE_PLACES_API_KEY if the operator chose to pay for everyone.
// Server only — it opens a sealed secret.
import { createAdminClient } from '@/lib/supabase';
import { openSecret } from '@/lib/crypto/secrets';

export type KeySource = 'workspace' | 'server';

export async function placesKeyFor(privy: string, workspace: string): Promise<{ key: string; from: KeySource } | { error: string; status: number } | null> {
  if (/^[0-9a-f-]{36}$/i.test(workspace)) {
    const { data, error } = await createAdminClient().rpc('get_data_source_secret', {
      p_privy: privy, p_workspace: workspace, p_source: 'google_places',
    });
    if (error) {
      if (/NOT_A_MEMBER/.test(error.message)) return { error: 'You are not a member of this workspace.', status: 403 };
      // A database without 0134 falls through to the server key, if any.
      if (!/get_data_source_secret|PGRST202|does not exist/i.test(error.message)) return { error: 'Could not read the Google key.', status: 500 };
    } else if (data?.cipher) {
      try { return { key: openSecret(data.cipher, data.iv, data.tag), from: 'workspace' }; }
      catch { return { error: 'The saved Google key can no longer be opened (the server’s encryption key changed). Connect it again.', status: 409 }; }
    }
  }
  const env = (process.env.GOOGLE_PLACES_API_KEY || '').trim();
  return env ? { key: env, from: 'server' } : null;
}
