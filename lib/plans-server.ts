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
