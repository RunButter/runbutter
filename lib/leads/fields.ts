// The Leads object: what a saved lead IS, and how a found business becomes one.
//
// ── A LEAD IS A CUSTOM OBJECT, NOT A NEW TABLE ──────────────────────────────
// Companies have no phone, email or website column, and adding them means
// redefining the CRUD monolith and another migration to run. A custom object
// (0087) already has everything a lead list needs: a table, cards on a phone,
// a board grouped by Status, mail merge, CSV export, automations on "lead
// created" (0132), and every agent tool — because all of those go through the
// same five functions. So Find leads creates an ordinary custom object called
// Leads, through the same save_custom_object / save_custom_field calls the
// manual builder uses, and saving a lead is an ordinary create_record. The
// workspace can rename it, add fields, or delete it like any other.
//
// Type-only imports, so the agent tools can read this file too.
import type { FoundPlace } from './osm';
import type { SiteCheck } from './enrich';

export const LEAD_SLUG = 'leads';

export const LEAD_STATUSES = ['New', 'Contacted', 'Interested', 'Won', 'Not interested'] as const;

export interface LeadFieldDef {
  key: string;
  label: string;
  type: 'text' | 'select' | 'email' | 'url' | 'phone' | 'number';
  options?: readonly string[];
  primary?: boolean;
  required?: boolean;
}

export const LEAD_FIELDS: LeadFieldDef[] = [
  { key: 'name', label: 'Name', type: 'text', primary: true, required: true },
  { key: 'status', label: 'Status', type: 'select', options: LEAD_STATUSES },
  { key: 'category', label: 'Category', type: 'text' },
  { key: 'city', label: 'City', type: 'text' },
  { key: 'phone', label: 'Phone', type: 'phone' },
  { key: 'email', label: 'Email', type: 'email' },
  { key: 'website', label: 'Website', type: 'url' },
  { key: 'address', label: 'Address', type: 'text' },
  { key: 'country', label: 'Country', type: 'text' },
  { key: 'opening_hours', label: 'Opening hours', type: 'text' },
  { key: 'facebook', label: 'Facebook', type: 'url' },
  { key: 'instagram', label: 'Instagram', type: 'url' },
  // Google Maps results carry these; OpenStreetMap has no reviews, so they
  // stay blank for a lead found there rather than reading as zero.
  { key: 'rating', label: 'Rating', type: 'number' },
  { key: 'reviews', label: 'Reviews', type: 'number' },
  // What "Check websites" found wrong with the lead's own site — the reason to
  // call, for anyone who sells websites, SEO or hosting.
  { key: 'website_check', label: 'Website check', type: 'text' },
  // Where the lead came from, as a link anybody can open. It is also what
  // stops the same business being saved twice from two searches.
  { key: 'source', label: 'Found on', type: 'url' },
];

export const LEAD_OBJECT = {
  slug: LEAD_SLUG,
  singular: 'Lead',
  plural: 'Leads',
  icon: 'Target',
  group_key: 'Sales',
  description: 'Businesses found with Find leads, and any you add yourself.',
};

/** What a person sees per result once the website has been read. */
export interface Enrichment {
  state: 'loading' | 'done';
  emails: string[];
  phones: string[];
  facebook: string;
  instagram: string;
  checked: string[];
  note?: string;
  check?: SiteCheck;
}

/** A found business, with whatever its website added, as the row a lead is. */
export function leadValues(p: FoundPlace, e?: Enrichment | null): Record<string, string> {
  const email = p.email || e?.emails?.[0] || '';
  return {
    name: p.name,
    status: 'New',
    category: p.category,
    city: p.city,
    phone: p.phone || e?.phones?.[0] || '',
    email,
    website: p.website,
    address: p.address,
    country: p.country,
    opening_hours: p.opening_hours,
    facebook: p.facebook || e?.facebook || '',
    instagram: p.instagram || e?.instagram || '',
    rating: p.rating !== undefined ? String(p.rating) : '',
    reviews: p.reviews !== undefined ? String(p.reviews) : '',
    website_check: websiteCheckText(p, e),
    source: p.url,
  };
}

/**
 * The website check as one line for the record: "No website", "Website down",
 * "No HTTPS · Not mobile-friendly · Wix", "Looks fine". Blank when nobody ran
 * the check — an unchecked site is not a fine one.
 */
export function websiteCheckText(p: Pick<FoundPlace, 'website'>, e?: Enrichment | null): string {
  if (!p.website) return 'No website';
  const c = e?.check;
  if (!c) return '';
  const parts = [...c.issues, ...(c.builder ? [c.builder] : [])];
  return parts.length ? parts.join(' · ') : 'Looks fine';
}

/** Worth offering a website to: none, or one with something wrong with it. */
export const needsWebsite = (p: Pick<FoundPlace, 'website'>, e?: Enrichment | null) =>
  !p.website || !!e?.check?.issues.length;

/** The same business found twice: by its map link, else by name in the same town. */
export const leadKeyOf = (name: string, city: string) =>
  `${String(name || '').trim().toLowerCase()}|${String(city || '').trim().toLowerCase()}`;
