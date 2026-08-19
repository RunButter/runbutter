/**
 * Plan enforcement, server side.
 *
 * WHY THIS FILE EXISTS. The only thing enforcing a paid plan was
 * `components/PlanGate.tsx` — a React component that hides a page by URL
 * prefix. `isFeatureAllowed` had one call site in the whole repo, `getLimit`
 * had one, and every limit in `lib/plans.ts` had zero:
 *
 *     maxRecords 0 · maxSeats 0 · maxCandidates 0 · maxAutomations 0 · maxESignPerMonth 0
 *
 * So a Free workspace could call `/api/v1/records`, `/api/mcp`,
 * `/api/agents/run` and `/api/sign/create` directly and get Business-tier
 * features. Hiding a button has never been access control, and this product
 * ships a documented REST API and an MCP server — two things whose entire
 * purpose is to be called without a browser.
 *
 * A REVENUE BOUNDARY, NOT A SECURITY ONE. Tenancy is enforced in SQL and is
 * unaffected by anything here: this decides what a workspace has paid for,
 * never which workspace you reach.
 *
 * IT CANNOT REPEAT THE PLANGATE BUG. That one treated an unreadable plan as
 * Free and walled an Enterprise customer out of a feature they owned. Every
 * failure path here resolves to `business` instead — see `workspacePlan`. The
 * two mistakes are not symmetrical and the code must not pretend they are.
 */

import { createAdminClient } from '@/lib/supabase';
import { isFeatureAllowed, minPlanFor, normalizePlan, PLANS, type PlanFeature } from '@/lib/plans';

/**
 * The plan a workspace is on.
 *
 * Reads `workspaces.plan`, the column every new-platform screen reads
 * (`get_my_workspace`, 0051). Stripe writes `companies.plan` and 0090's trigger
 * copies it across; that split has bitten this codebase before, so the rule is
 * to read what the product reads and let the trigger be the bridge.
 *
 * FAILS OPEN, DELIBERATELY. If the plan cannot be read — a network blip, a row
 * that has not synced — the caller is let through as `business`. Refusing on a
 * failed lookup takes paying customers offline to protect revenue from free
 * ones. The cost of a miss is a free user getting a feature for an hour; the
 * cost of a false block is a support incident with somebody who is paying.
 */
export async function workspacePlan(workspaceId: string): Promise<string> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('workspaces').select('plan').eq('id', workspaceId).maybeSingle();
    const raw = (data as any)?.plan;
    if (error || !raw) return 'business';
    return normalizePlan(raw);
  } catch {
    return 'business';
  }
}

export interface PlanDenial { plan: string; feature: PlanFeature; needs: string; message: string }

/**
 * Does this workspace have the feature? Null when it does, a described denial
 * when it does not.
 *
 * The message names the feature, the plan that includes it, and where to change
 * it. An integrator who gets "Forbidden" from a REST API opens a support
 * ticket; one who gets "the REST API needs the Business plan" upgrades or stops.
 */
export async function checkFeature(workspaceId: string, feature: PlanFeature): Promise<PlanDenial | null> {
  const plan = await workspacePlan(workspaceId);
  if (isFeatureAllowed(plan, feature)) return null;
  const needs = minPlanFor(feature);
  const needsName = needs ? PLANS[needs].name : 'a paid';
  return {
    plan, feature, needs: needs || '',
    message:
      `${FEATURE_SENTENCE[feature] ?? feature} is not included in the ${PLANS[normalizePlan(plan)].name} plan. ` +
      `It needs ${needsName}. Change it in Settings → Plans.`,
  };
}

/**
 * How each gated feature is named in an error a stranger will read.
 *
 * Not `FEATURE_LABELS` from lib/plans.ts: those are picker labels written to
 * sit in a column of a pricing table, and a 402 body reads better as a sentence
 * subject. Only what is gated server-side appears here; anything else falls
 * back to its raw name rather than pretending to a nicer one.
 */
const FEATURE_SENTENCE: Partial<Record<PlanFeature, string>> = {
  apiAccess: 'The REST API and MCP server',
  aiAgents: 'AI agents',
  eSignatures: 'E-signatures',
};

/**
 * The body every gated route answers with.
 *
 * 402 PAYMENT REQUIRED, not 403. A caller that is correctly authenticated and
 * correctly scoped, whose workspace simply has not bought this, is exactly what
 * 402 means. 403 sends an integrator hunting a permissions bug that does not
 * exist, and 404 would be a lie.
 */
export function planDeniedBody(d: PlanDenial) {
  return {
    error: d.message,
    // Machine-readable, because the callers here are scripts and agents as
    // often as people. An MCP client can act on `upgrade_required` without
    // parsing English.
    code: 'upgrade_required' as const,
    feature: d.feature,
    plan: d.plan,
    requiredPlan: d.needs,
  };
}

// ── Numeric limits ──────────────────────────────────────────────────────────
//
// `checkFeature` above answers "has this workspace bought the feature". These
// answer "has it used up the allowance", which nothing has ever asked. Six
// limits shipped with the pivot, are printed on the landing page, in Settings →
// Plans and on the billing screen, and had zero enforcement call sites between
// them: a Free workspace could hold a million records and run twenty
// automations, and the numbers on the pricing page were decoration.

import { getLimit, type PlanLimits } from '@/lib/plans';

export type LimitKey = keyof PlanLimits;

/** Which usage counter answers each limit. One map, so the pairing is stated once. */
const USAGE_KEY: Record<LimitKey, string> = {
  maxSeats: 'seats',
  maxRecords: 'records',
  maxPositions: 'positions',
  maxCandidates: 'candidates',
  maxAutomations: 'automations',
  maxESignPerMonth: 'esign_month',
};

/** How each limit is named in a sentence somebody reads at the moment it stops them. */
const LIMIT_NOUN: Record<LimitKey, string> = {
  maxSeats: 'people in the workspace',
  maxRecords: 'records',
  maxPositions: 'open positions',
  maxCandidates: 'candidates',
  maxAutomations: 'automations',
  maxESignPerMonth: 'e-signatures this month',
};

export interface LimitDenial {
  plan: string; limit: LimitKey; used: number; max: number; message: string;
}

/**
 * Every counter for a workspace, or null if it cannot be read.
 *
 * One RPC (0126), shared with the usage bars on the plans screen. Two counts of
 * "how many records is that" eventually disagree, and the number somebody is
 * SHOWN has to be the number that blocks them — being refused at 500 while the
 * screen says 486 is worse than showing nothing.
 */
export async function planUsage(privy: string, workspaceId: string): Promise<Record<string, number> | null> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('get_plan_usage', { p_privy: privy, p_workspace: workspaceId });
    if (error || !data || typeof data !== 'object') return null;
    return data as Record<string, number>;
  } catch {
    return null;
  }
}

/**
 * Is there room for one more? Null when there is, a described denial when not.
 *
 * ── FAILS OPEN, LIKE EVERYTHING ELSE HERE ───────────────────────────────────
 * An unreadable plan resolves to `business` and an unreadable COUNT lets the
 * write through. The asymmetry is deliberate and is the lesson PlanGate taught:
 * the cost of a miss is a free workspace keeping one extra row for an hour, and
 * the cost of a false block is a paying customer unable to enter data with no
 * way to tell why. Those are not the same mistake.
 *
 * `Infinity` short-circuits before any query, so a Business workspace — every
 * workspace that matters for throughput — pays nothing for this at all.
 */
export async function checkLimit(
  privy: string, workspaceId: string, limit: LimitKey, adding = 1,
): Promise<LimitDenial | null> {
  const plan = await workspacePlan(workspaceId);
  const max = getLimit(plan, limit);
  if (!isFinite(max)) return null;

  const usage = await planUsage(privy, workspaceId);
  if (!usage) return null;
  const used = Number(usage[USAGE_KEY[limit]] ?? 0);
  if (used + adding <= max) return null;

  return {
    plan, limit, used, max,
    message: max === 0
      ? `${capitalize(LIMIT_NOUN[limit])} are not included in the ${PLANS[normalizePlan(plan)].name} plan. Change it in Settings → Plans.`
      : `The ${PLANS[normalizePlan(plan)].name} plan allows ${max.toLocaleString()} ${LIMIT_NOUN[limit]} and this workspace has ${used.toLocaleString()}. Change it in Settings → Plans.`,
  };
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The body a route answers a limit with.
 *
 * 402 again, and the same `upgrade_required` code as a missing feature: to a
 * script the two are one situation — this workspace needs a bigger plan — and
 * splitting them would make every integrator handle two codes for one fix.
 * `limit`, `used` and `max` are there so a client can say something useful
 * without parsing the sentence.
 */
export function limitDeniedBody(d: LimitDenial) {
  return {
    error: d.message,
    code: 'upgrade_required' as const,
    limit: d.limit,
    used: d.used,
    max: isFinite(d.max) ? d.max : null,
    plan: d.plan,
  };
}
