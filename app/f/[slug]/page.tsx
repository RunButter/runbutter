import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase';
import Logo from '@/components/Logo';
import PublicForm, { type PublicFormData } from './PublicForm';

export const dynamic = 'force-dynamic';

// Public, no-session form page. The slug is the only identifier; get_public_form
// returns null for anything unknown. Rendered server-side so search engines and
// link previews see real content.
export default async function FormPage({ params }: { params: { slug: string } }) {
  const slug = (params.slug || '').toLowerCase();
  let form: PublicFormData | null = null;
  if (/^[a-z0-9]{4,32}$/.test(slug)) {
    const { data } = await createAdminClient().rpc('get_public_form', { p_slug: slug });
    form = (data as PublicFormData) ?? null;
  }

  return (
    <div className="min-h-screen bg-canvas text-primary flex flex-col">
      <header className="h-14 shrink-0 border-b border-subtle flex items-center px-6">
        <Link href="/"><Logo /></Link>
      </header>
      <div className="flex-1 flex items-start justify-center px-6 py-12">
        {form && form.enabled ? (
          <PublicForm slug={slug} form={form} />
        ) : (
          <div className="w-full max-w-md rounded-xl bg-surface border border-subtle p-8 text-center mt-8">
            <h1 className="text-lg font-medium text-primary">This form isn&rsquo;t available</h1>
            <p className="mt-2 text-[13px] text-secondary">The link may be wrong, or the form is closed. Check with whoever shared it.</p>
          </div>
        )}
      </div>
    </div>
  );
}
