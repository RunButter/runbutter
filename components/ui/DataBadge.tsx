// Renders NOTHING when the data is live, and a quiet chip when it isn't.
//
// Every page used to print a green "LIVE" badge next to its title. That badge
// was true on virtually every screen a signed-in customer ever saw, so it
// carried no information — it was a permanent decoration competing with the
// page title for attention, on sixteen screens.
//
// The "Sample" case is the opposite and is kept: when an RPC is missing or
// nobody is signed in, the loaders fall back to fabricated rows (see
// lib/crm/*.ts). Someone reading invented revenue figures has to be told, or
// the fallback becomes a lie. So: silence when it's real, a word when it isn't.
export default function DataBadge({ live }: { live: boolean }) {
  if (live) return null;
  return (
    <span className="text-3xs font-medium px-1.5 py-0.5 rounded-md bg-warning/10 text-warning">
      Sample data
    </span>
  );
}
