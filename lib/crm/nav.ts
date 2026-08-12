'use client';

import { useEffect, useState } from 'react';
import { NAV, OBJECTS } from './registry';
import { loadCustomObjects, type CustomObject } from './custom';
import { loadObjectSettings, EMPTY_SETTINGS, viewSlug, type ObjectSettings } from './objects';
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
 * The built-ins, as this workspace renamed, hid and re-filed them (0097).
 *
 * Runs BEFORE the custom objects are folded in, so a renamed built-in and a
 * custom object land in the same section by the same rule. Only entries that
 * point at an object are touched: `/finance/overview` is a screen, not a
 * record type, and nothing in Settings offers to rename it.
 *
 * A section that ends up empty is DROPPED. Hiding the only two things in
 * Projects and leaving a "Projects" heading with nothing under it looks like a
 * loading failure, and it is the shape people actually produce — you hide a
 * pillar by hiding its contents.
 */
export function navWithOverrides(settings: ObjectSettings, nav: any[] = NAV): NavGroup[] {
  const ovs = settings.overrides;
  if (Object.keys(ovs).length === 0) return nav as NavGroup[];

  // slug → its nav entry. Built by matching hrefs rather than by name, because
  // the nav item's own `slug` and the object's slug agree for most entries and
  // not all of them (Deals, Overview).
  const objectOf = (item: NavItem) => {
    const m = /^\/objects\/([a-z0-9_]+)$/.exec(item.href);
    return m && OBJECTS[m[1]] ? viewSlug(m[1]) : null;
  };

  const out: NavGroup[] = [];
  const moved: { group: string; item: NavItem }[] = [];

  for (const g of nav) {
    const items: NavItem[] = [];
    for (const item of g.items as NavItem[]) {
      const slug = objectOf(item);
      const ov = slug ? ovs[slug] : null;
      if (!ov) { items.push(item); continue; }
      if (ov.hidden) continue;
      const next: NavItem = { ...item, label: ov.plural?.trim() || item.label, icon: ov.icon?.trim() || item.icon };
      // An object filed into a section it is not already in moves; one filed
      // into a section that no longer exists stays where it is rather than
      // disappearing, the same rule custom objects get below.
      const target = (ov.group_key || '').trim();
      if (target && norm(target) !== norm(g.group)) { moved.push({ group: target, item: next }); continue; }
      items.push(next);
    }
    out.push({ ...g, items });
  }

  for (const { group, item } of moved) {
    const target = out.find((g) => norm(g.group) === norm(group));
    (target ?? out[0]).items.push(item);
  }

  return out.filter((g) => g.items.length > 0);
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
  const [settings, setSettings] = useState<ObjectSettings>(EMPTY_SETTINGS);

  useEffect(() => {
    if (!enabled || !privy) return;
    let cancelled = false;
    getWorkspace(privy)
      .then(async (w) => {
        if (!w?.id || cancelled) return;
        // Both in flight together. Sequentially, the sidebar would show the
        // shipped names, then the workspace's, and the second reflow is
        // visible on every page load.
        const [objs, setts] = await Promise.all([
          loadCustomObjects(privy, w.id),
          loadObjectSettings(privy, w.id),
        ]);
        if (cancelled) return;
        if (objs?.rows) setObjects(objs.rows);
        if (setts?.settings) setSettings(setts.settings);
      })
      // A workspace that has not run 0087/0097 has no custom objects and no
      // overrides, which is the same nav as a workspace with none. Nothing to
      // report.
      .catch(() => {});
    return () => { cancelled = true; };
  }, [privy, enabled]);

  return navWithCustomObjects(objects, navWithOverrides(settings));
}
