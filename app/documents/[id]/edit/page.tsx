'use client';

import { useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AppLoading from '@/components/ui/AppLoading';

// The full-page builder that lived here is replaced by DocumentComposer, a
// popup over the document itself. Old links and bookmarks still land in the
// right place: the document, with the editor open.
export default function EditRedirect() {
  const router = useRouter();
  const id = String(useParams().id);
  useEffect(() => { router.replace(`/documents/${id}?edit=1`); }, [router, id]);
  return <AppLoading />;
}
