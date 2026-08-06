import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * The URL the SERVER should use, which is not always the one the browser uses.
 *
 * On the hosted product they are the same string and this changes nothing. In
 * `docker compose` they cannot be: the browser has to be told
 * `http://localhost:8000`, because that is what the person's own machine can
 * reach — and `NEXT_PUBLIC_*` is compiled into the bundle at build time, so it
 * cannot be a container hostname. But inside the app container `localhost:8000`
 * is the app container itself, where nothing is listening.
 *
 * The compose file's own comment claimed server calls went "straight to the
 * gateway container", and no variable ever made that true: every server-side
 * call — /api/rpc, the seed route, MCP, file uploads — would have connected to
 * itself and failed. The app booted; nothing in it worked.
 *
 * So `SUPABASE_URL` is a server-only override. Unset, this is exactly the old
 * behaviour.
 */
export const serverSupabaseUrl = () => process.env.SUPABASE_URL || supabaseUrl;

// Browser client — safe to call from Client Components
export function createSupabaseClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

// Named singleton for Client Components (backwards-compat with existing imports)
export const supabase = createBrowserClient(supabaseUrl, supabaseAnonKey);

// Storage helpers
export const STORAGE_BUCKETS = {
  CV: 'candidate-cvs',
  LOGO: 'company-logos',
} as const;

export async function uploadCV(file: File, candidateId: string): Promise<string | null> {
  const fileName = `${candidateId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKETS.CV)
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
    });

  if (error) {
    console.error('Error uploading CV to Supabase:', error);
    // Log the error message to help the developer diagnose bucket issues
    if (error.message === 'bucket_not_found') {
      console.warn('The bucket "candidate-cvs" was not found. Please create it in the Supabase Dashboard.');
    }
    return null;
  }

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKETS.CV)
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

export async function uploadLogo(file: File, companyId: string): Promise<string | null> {
  const fileName = `${companyId}/logo-${Date.now()}.png`;

  const { error } = await supabase.storage
    .from(STORAGE_BUCKETS.LOGO)
    .upload(fileName, file, {
      cacheControl: '3600',
      upsert: true,
    });

  if (error) {
    console.error('Error uploading logo:', error);
    return null;
  }

  const { data: urlData } = supabase.storage
    .from(STORAGE_BUCKETS.LOGO)
    .getPublicUrl(fileName);

  return urlData.publicUrl;
}

export async function deleteFile(bucket: string, path: string): Promise<boolean> {
  const { error } = await supabase.storage.from(bucket).remove([path]);

  if (error) {
    console.error('Error deleting file:', error);
    return false;
  }

  return true;
}

// Server-side admin client — only import in API routes / Server Components
export function createAdminClient() {
  return createClient(
    serverSupabaseUrl(),
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? supabaseAnonKey,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
