import {
  // Built-in nav — every icon lib/crm/registry.ts declares.
  ArrowLeftRight, BarChart3, BookOpen, Bot, Briefcase, Building2, Calendar, Columns3, CreditCard,
  FileBarChart, FileInput, FileStack, FileText, FolderKanban, FolderOpen, GanttChartSquare, QrCode,
  Globe, Globe2, Heart, Laptop, LayoutDashboard, Link2, ListTodo, Mail, Megaphone, MessageCircle,
  Package, Palette, PenLine, PenSquare, Plug, Radio, Receipt, Rocket, ShieldCheck, Sparkles,
  Table2, Target, TrendingUp, Users, Wallet, Waypoints, Zap, Gauge, LineChart, KeyRound, CalendarDays, PieChart,
  // The custom-object vocabulary — see OBJECT_ICON_NAMES in lib/workspace/blueprint.ts.
  Truck, IdCard, Stethoscope, HeartPulse, CalendarClock, Factory, Cog, Layers, Repeat, Timer,
  Building, Home, FileSignature, Wrench, HardHat, ShoppingCart, Undo2, GraduationCap,
  HeartHandshake, Gift, ClipboardList, Boxes, Ticket, Utensils, Hammer, Ship, Beaker, Scale,
  Camera, Leaf, Map, Key, Shirt, Wine, Dumbbell, Baby, PawPrint, Anchor, Warehouse, Handshake,
  type LucideIcon,
} from 'lucide-react';
import { OBJECT_ICON_NAMES } from '@/lib/workspace/blueprint';
import { NAV } from '@/lib/crm/registry';

/**
 * THE icon registry — one map, for the nav rail, the command palette and every
 * custom object.
 *
 * There used to be two hand-kept copies of this (NavRail and CommandPalette),
 * and neither knew any of the names the vertical templates declare. The result
 * was quiet rather than broken: a Vehicles object shipped with `Truck`, missed
 * the map, and fell back to the generic people glyph — so every custom object
 * in the nav looked identical to every other one, and the icon a template chose
 * had no effect anywhere.
 *
 * The NAMES live in lib/workspace/blueprint.ts, which has no imports, because
 * the AI builder's prompt is assembled in a route handler and must not pull
 * lucide (or anything client-shaped) in to read a list of strings. This file is
 * the half that maps those names to components; the check below is what stops
 * the two halves drifting again.
 */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  ArrowLeftRight, BarChart3, BookOpen, Bot, Briefcase, Building2, Calendar, Columns3, CreditCard,
  FileBarChart, FileInput, FileStack, FileText, FolderKanban, FolderOpen, GanttChartSquare, QrCode,
  Globe, Globe2, Heart, Laptop, LayoutDashboard, Link2, ListTodo, Mail, Megaphone, MessageCircle,
  Package, Palette, PenLine, PenSquare, Plug, Radio, Receipt, Rocket, ShieldCheck, Sparkles,
  Table2, Target, TrendingUp, Users, Wallet, Waypoints, Zap, Gauge, LineChart, KeyRound, CalendarDays, PieChart,
  Truck, IdCard, Stethoscope, HeartPulse, CalendarClock, Factory, Cog, Layers, Repeat, Timer,
  Building, Home, FileSignature, Wrench, HardHat, ShoppingCart, Undo2, GraduationCap,
  HeartHandshake, Gift, ClipboardList, Boxes, Ticket, Utensils, Hammer, Ship, Beaker, Scale,
  Camera, Leaf, Map, Key, Shirt, Wine, Dumbbell, Baby, PawPrint, Anchor, Warehouse, Handshake,
};

/**
 * Fail at import if the vocabulary offers a name this file cannot draw.
 *
 * Same reasoning as `lib/agents/tools.ts` checking itself against the tool
 * catalogue: a name the picker offers and the nav cannot render is a silent
 * downgrade, and silent downgrades survive review. This throws in the module
 * that would have fallen back, so it is impossible to add one name without the
 * other.
 */
const missing = [
  ...OBJECT_ICON_NAMES,
  /*
   * THE NAV WAS NOT COVERED BY THIS CHECK AND SHOULD ALWAYS HAVE BEEN.
   *
   * `iconFor` falls back to Table2 for a name it does not know, so three nav
   * entries added later (Gauge, LineChart, KeyRound) rendered a spreadsheet
   * glyph in the rail and in ⌘K, and nothing anywhere said so — precisely the
   * silent downgrade this guard exists to stop, one list over. registry.ts
   * imports only a type, so reading NAV here creates no cycle.
   */
  ...NAV.flatMap((g) => g.items.map((i) => i.icon)),
].filter((n) => !ICON_REGISTRY[n]);
if (missing.length) {
  throw new Error(`object-icons: no component for ${[...new Set(missing)].join(', ')} — import it here, or drop it from OBJECT_ICON_NAMES / NAV.`);
}

/** Resolve a stored icon name. `fallback` is what an unknown name becomes. */
export const iconFor = (name: string | undefined, fallback: LucideIcon = Table2): LucideIcon =>
  (name && ICON_REGISTRY[name]) || fallback;
