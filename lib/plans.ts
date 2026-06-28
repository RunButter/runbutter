export type SubscriptionPlan = 'free' | 'starter' | 'professional' | 'enterprise';

export type PlanFeature =
    | 'talentTreasury'
    | 'resumeSearch'
    | 'sourceTracking'
    | 'emailTemplates'
    | 'branding'
    | 'interviews'
    | 'myTeam'
    | 'teamFit'
    | 'advancedAnalytics'
    | 'gdprControls'
    | 'hrisExport'
    | 'sso';

export const ALL_FEATURES: PlanFeature[] = [
    'talentTreasury', 'resumeSearch', 'sourceTracking', 'emailTemplates', 'branding',
    'interviews', 'myTeam', 'teamFit', 'advancedAnalytics', 'gdprControls', 'hrisExport', 'sso',
];

export interface PlanDef {
    name: string;
    price: string;
    priceValue: number;
    tagline: string;
    limits: { maxPositions: number; maxCandidates: number; maxSeats: number; maxRecords: number };
    features: Record<PlanFeature, boolean>;
}

const f = (enabled: PlanFeature[]): Record<PlanFeature, boolean> =>
    ALL_FEATURES.reduce((acc, x) => { acc[x] = enabled.includes(x); return acc; }, {} as Record<PlanFeature, boolean>);

const STARTER_FEATURES: PlanFeature[] = ['talentTreasury', 'resumeSearch', 'sourceTracking', 'emailTemplates', 'branding'];
const PRO_FEATURES: PlanFeature[] = [...STARTER_FEATURES, 'interviews', 'myTeam', 'teamFit', 'advancedAnalytics', 'gdprControls'];

export const PLANS: Record<SubscriptionPlan, PlanDef> = {
    free: {
        name: 'Free', price: '$0', priceValue: 0, tagline: 'Get started',
        limits: { maxPositions: 1, maxCandidates: 25, maxSeats: 1, maxRecords: 25 },
        features: f([]),
    },
    starter: {
        name: 'Starter', price: '$99', priceValue: 99, tagline: 'For growing teams',
        limits: { maxPositions: 5, maxCandidates: 250, maxSeats: 3, maxRecords: 250 },
        features: f(STARTER_FEATURES),
    },
    professional: {
        name: 'Professional', price: '$299', priceValue: 299, tagline: 'For scaling teams',
        limits: { maxPositions: 25, maxCandidates: 2500, maxSeats: 10, maxRecords: 2500 },
        features: f(PRO_FEATURES),
    },
    enterprise: {
        name: 'Enterprise', price: 'Custom', priceValue: 0, tagline: 'For organizations',
        limits: { maxPositions: Infinity, maxCandidates: Infinity, maxSeats: Infinity, maxRecords: Infinity },
        features: f(ALL_FEATURES),
    },
};

export const PLAN_ORDER: SubscriptionPlan[] = ['free', 'starter', 'professional', 'enterprise'];

export function isFeatureAllowed(plan: string | null | undefined, feature: PlanFeature): boolean {
    const p = (plan && plan in PLANS ? plan : 'free') as SubscriptionPlan;
    return !!PLANS[p].features[feature];
}

export function getLimit(plan: string | null | undefined, key: keyof PlanDef['limits']): number {
    const p = (plan && plan in PLANS ? plan : 'free') as SubscriptionPlan;
    return PLANS[p].limits[key];
}

export function minPlanFor(feature: PlanFeature): SubscriptionPlan | null {
    for (const p of PLAN_ORDER) if (PLANS[p].features[feature]) return p;
    return null;
}

export function formatLimit(n: number): string {
    return isFinite(n) ? n.toLocaleString() : 'Unlimited';
}

// Display names for the per-feature flags (used by the in-app Plans page).
export const FEATURE_LABELS: Record<PlanFeature, string> = {
    talentTreasury: 'Talent Treasury',
    resumeSearch: 'Resume search',
    sourceTracking: 'Source tracking',
    emailTemplates: 'Email templates',
    branding: 'Custom branding',
    interviews: 'Calendar interviews',
    myTeam: 'My Team',
    teamFit: 'Team Fit simulator',
    advancedAnalytics: 'Advanced analytics',
    gdprControls: 'GDPR controls',
    hrisExport: 'HRIS export',
    sso: 'SSO',
};