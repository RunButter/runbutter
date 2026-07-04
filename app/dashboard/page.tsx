import { redirect } from 'next/navigation';

// The ATS dashboard is now the HR Overview, rebuilt in the platform design
// system at /dashboard/overview. Keep this index as a redirect so old links
// (and the post-login landing) resolve to it.
export default function DashboardIndex() {
  redirect('/dashboard/overview');
}
