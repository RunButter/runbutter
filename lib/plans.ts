// Plans / entitlements — the single source of truth for what a workspace may do.
//
// Business model (decided 2026-07-24): the repo is MIT and self-hosting gets
// EVERYTHING. These tiers govern the hosted service only — we sell convenience,
// managed infra and support, not a legal moat. Pricing is PER SEAT, because an
// all-in-one company OS is used by the whole company; a flat per-company price
// charged a 30-person customer the same as a 3-person one.
//
// Gating principle: never gate the relational core (companies, people, deals,
// invoices, projects, issues, pipeline, CSV export) — that is what earns
// adoption and word of mouth. Charge for SCALE (seats, records, volume),
// AUTOMATION + AI, and GOVERNANCE.

export type SubscriptionPlan = 'free' | 'team' | 'business' | 'enterprise';

// companies.plan / workspaces.plan store the raw string, and rows created before
// the pivot use the old names. Everything funnels through normalizePlan() so a
// legacy value never silently downgrades a paying customer to Free.
const LEGACY_PLAN: Record<string, SubscriptionPlan> = {
    starter: 'team',
    professional: 'business',
    pro: 'business',
};

export function normalizePlan(raw: string | null | undefined): SubscriptionPlan {
    const v = String(raw || '').toLowerCase().trim();
    if (v in PLANS) return v as SubscriptionPlan;
    return LEGACY_PLAN[v] ?? 'free';
}

export type PlanFeature =
    // ── Team ──────────────────────────────────────────────────────────────
    | 'automations'        // trigger → action rules + outgoing webhooks
    | 'emailTemplates'
    | 'branding'           // your logo/colours on invoices, apply pages, review links
    | 'eSignatures'
    | 'webAnalytics'
    | 'postStudio'         // social composer, pixel previews, client review links
    | 'shortLinks'
    | 'customForms'
    | 'resumeSearch'
    | 'talentTreasury'
    | 'interviews'
    // ── Business ──────────────────────────────────────────────────────────
    | 'aiAgents'           // headline feature; BYO key so it costs us nothing to serve
    | 'apiAccess'          // REST API + MCP server
    | 'scheduledReports'
    | 'advancedAnalytics'
    | 'sourceTracking'     // UTM links + click→apply→hire attribution
    | 'teamFit'
    | 'myTeam'
    | 'gdprControls'
    // ── Enterprise ────────────────────────────────────────────────────────
    | 'sso'
    | 'auditLog'
    | 'hrisExport';

export const ALL_FEATURES: PlanFeature[] = [
    'automations', 'emailTemplates', 'branding', 'eSignatures', 'webAnalytics',
    'postStudio', 'shortLinks', 'customForms', 'resumeSearch', 'talentTreasury', 'interviews',
    'aiAgents', 'apiAccess', 'scheduledReports', 'advancedAnalytics', 'sourceTracking',
    'teamFit', 'myTeam', 'gdprControls',
    'sso', 'auditLog', 'hrisExport',
];

export interface PlanLimits {
    maxSeats: number;
    maxRecords: number;          // CRM/finance/project records across the workspace
    maxPositions: number;        // HR module
    maxCandidates: number;       // HR module
    maxAutomations: number;
    maxESignPerMonth: number;
}

export interface PlanDef {
    name: string;
    /** Display price. Per-seat tiers render as "$15 /seat". */
    price: string;
    /** Monthly price PER SEAT (0 for Free / bespoke Enterprise). */
    priceValue: number;
    perSeat: boolean;
    tagline: string;
    limits: PlanLimits;
    features: Record<PlanFeature, boolean>;
}

const f = (enabled: PlanFeature[]): Record<PlanFeature, boolean> =>
    ALL_FEATURES.reduce((acc, x) => { acc[x] = enabled.includes(x); return acc; }, {} as Record<PlanFeature, boolean>);

const TEAM_FEATURES: PlanFeature[] = [
    'automations', 'emailTemplates', 'branding', 'eSignatures', 'webAnalytics',
    'postStudio', 'shortLinks', 'customForms', 'resumeSearch', 'talentTreasury', 'interviews',
];
const BUSINESS_FEATURES: PlanFeature[] = [
    ...TEAM_FEATURES,
    'aiAgents', 'apiAccess', 'scheduledReports', 'advancedAnalytics', 'sourceTracking',
    'teamFit', 'myTeam', 'gdprControls',
];

export const PLANS: Record<SubscriptionPlan, PlanDef> = {
    free: {
        name: 'Free', price: '$0', priceValue: 0, perSeat: false,
        tagline: 'The whole core, for a small team',
        limits: {
            maxSeats: 2, maxRecords: 500, maxPositions: 1, maxCandidates: 25,
            maxAutomations: 0, maxESignPerMonth: 0,
        },
        features: f([]),
    },
    team: {
        name: 'Team', price: '$15', priceValue: 15, perSeat: true,
        tagline: 'Run the company on it',
        limits: {
            maxSeats: Infinity, maxRecords: 25000, maxPositions: 10, maxCandidates: 1000,
            maxAutomations: 20, maxESignPerMonth: 10,
        },
        features: f(TEAM_FEATURES),
    },
    business: {
        name: 'Business', price: '$39', priceValue: 39, perSeat: true,
        tagline: 'AI agents, API and analytics',
        limits: {
            maxSeats: Infinity, maxRecords: Infinity, maxPositions: Infinity, maxCandidates: Infinity,
            maxAutomations: Infinity, maxESignPerMonth: Infinity,
        },
        features: f(BUSINESS_FEATURES),
    },
    enterprise: {
        name: 'Enterprise', price: 'Custom', priceValue: 0, perSeat: true,
        tagline: 'SSO, audit and support',
        limits: {
            maxSeats: Infinity, maxRecords: Infinity, maxPositions: Infinity, maxCandidates: Infinity,
            maxAutomations: Infinity, maxESignPerMonth: Infinity,
        },
        features: f(ALL_FEATURES),
    },
};

export const PLAN_ORDER: SubscriptionPlan[] = ['free', 'team', 'business', 'enterprise'];

export function isFeatureAllowed(plan: string | null | undefined, feature: PlanFeature): boolean {
    return !!PLANS[normalizePlan(plan)].features[feature];
}

export function getLimit(plan: string | null | undefined, key: keyof PlanLimits): number {
    return PLANS[normalizePlan(plan)].limits[key];
}

export function minPlanFor(feature: PlanFeature): SubscriptionPlan | null {
    for (const p of PLAN_ORDER) if (PLANS[p].features[feature]) return p;
    return null;
}

export function formatLimit(n: number): string {
    return isFinite(n) ? n.toLocaleString() : 'Unlimited';
}

/** "$15 /seat" for per-seat tiers, plain price otherwise. */
export function formatPrice(plan: SubscriptionPlan): string {
    const p = PLANS[plan];
    return p.perSeat && p.priceValue > 0 ? `${p.price} /seat` : p.price;
}

// Display names for the per-feature flags (in-app Plans page + pricing tables).
export const FEATURE_LABELS: Record<PlanFeature, string> = {
    automations: 'Automations & webhooks',
    emailTemplates: 'Email templates',
    branding: 'Custom branding',
    eSignatures: 'E-signatures',
    webAnalytics: 'Web analytics',
    postStudio: 'Post studio & client review',
    shortLinks: 'Short links',
    customForms: 'Custom forms',
    resumeSearch: 'Resume search',
    talentTreasury: 'Talent Treasury',
    interviews: 'Calendar interviews',
    aiAgents: 'AI agents',
    apiAccess: 'REST API & MCP server',
    scheduledReports: 'Scheduled reports',
    advancedAnalytics: 'Advanced analytics',
    sourceTracking: 'Source tracking & attribution',
    teamFit: 'Team Fit simulator',
    myTeam: 'My Team',
    gdprControls: 'GDPR controls',
    sso: 'SSO / SAML',
    auditLog: 'Audit log',
    hrisExport: 'HRIS export',
};
