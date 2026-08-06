'use client';

import { useEffect, useState } from 'react';
import { NAV } from './registry';
import { loadCustomObjects, type CustomObject } from './custom';
import { getWorkspace } from './data';

/**
 * The nav, with the workspace's own objects folded into it.
 *
 * WHY THIS EXISTS. `custom_objects.group_key` has been written since 0087 — the
 * create form asks "Nav group" and stores the answer — and nothing ever read
 * it. A custom object appeared in exactly one place: the "Open" button on
 * Settings → Objects. Someone who added Vehicles got a working table, a working
 * form, import, export and agent access, and no way to reach any of it twice.
 * That is the whole of the user-visible bug: the data was right, the nav simply
 * never asked.
 *
 * The group is now a CHOICE FROM THE REAL GROUPS rather than free text, because
 * a typo used to be unrecoverable — "sales " with a trailing space is not the
 * Sales pillar, and there was no way to tell from the screen. Free-text values
 * already stored still work: an unrecognised group becomes its own section
 * rather than vanishing, which is the only behaviour that does not lose
 * someone's object.
 */

export interface NavItem { slug: string; label: string; icon: string; href: string; custom?: boolean }
export interface NavGroup { group: string; pinned?: boolean; items: NavItem[] }

/**
 * Where a custom object may be filed.
 *
 * Automate, Settings and Account are deliberately absent. They are not places
 * you keep records — putting Vehicles between "Members & roles" and "Plans &
 * billing" makes both harder to find, and the whole reason Settings is split
 * from Account is that the distinction is about who a change affects, which a
 * record type has no answer to.
 */
export const CUSTOM_OBJECT_GROUPS = ['Workspace', 'Sales', 'Finance', 'Marketing', 'HR', 'Projects', 'Team'];

const norm = (s: string) => s.trim().toLowerCase();

/** Pure: NAV + the workspace's objects → the nav to render. */
export function navWithCustomObjects(objects: CustomObject[], nav: any[] = NAV): NavGroup[] {
  const usable = objects
    .filter((o) => o.enabled !== false)
    .sort((a, b) => a.position - b.position || a.plural.localeCompare(b.plural));
  if (usable.length === 0) return nav as NavGroup[];

  const out: NavGroup[] = nav.map((g: any) => ({ ...g, items: [...g.items] }));
  const byGroup = new Map(out.map((g) => [norm(g.group), g]));
  const extra: NavGroup[] = [];

  for (const o of usable) {
    const item: NavItem = {
      // Prefixed so a custom object called "docs" cannot collide with the
      // built-in Docs entry — these slugs are React keys and badge keys.
      slug: `object:${o.slug}`,
      label: o.plural,
      icon: o.icon || 'Table2',
      href: `/objects/${o.slug}`,
      custom: true,
    };
    const key = norm(o.group_key || 'Workspace');
    const target = byGroup.get(key);
    if (target) { target.items.push(item); continue; }
    // A group nobody recognises still has to appear somewhere.
    let made = extra.find((g) => norm(g.group) === key);
    if (!made) { made = { group: (o.group_key || 'Workspace').trim(), items: [] }; extra.push(made); }
    made.items.push(item);
  }

  if (extra.length === 0) return out;
  // Before Settings, so the workspace's own sections sit with the product's
  // and configuration stays last.
  const at = out.findIndex((g) => g.group === 'Settings');
  const idx = at === -1 ? out.length : at;
  return [...out.slice(0, idx), ...extra, ...out.slice(idx)];
}

/**
 * Load this workspace's objects and return the merged nav.
 *
 * `enabled` exists for the command palette, which is mounted on every screen
 * but only needs this once it is opened — a list of objects nobody has asked to
 * see is a round trip on every page load.
 */
export function useNav(privy: string | null, enabled = true): NavGroup[] {
  const [objects, setObjects] = useState<CustomObject[]>([]);

  useEffect(() => {
    if (!enabled || !privy) return;
    let cancelled = false;
    getWorkspace(privy)
      .then((w) => (w?.id ? loadCustomObjects(privy, w.id) : null))
      .then((res) => { if (!cancelled && res?.rows) setObjects(res.rows); })
      // A workspace that has not run 0087 has no custom objects, which is the
      // same nav as a workspace with none. Nothing to report.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [privy, enabled]);

  return navWithCustomObjects(objects);
}
