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
    limits: { maxPositions: number; maxCandidates: number; maxSeats: number };
    features: Record<PlanFeature, boolean>;
}

const f = (enabled: PlanFeature[]): Record<PlanFeature, boolean> =>
    ALL_FEATURES.reduce((acc, x) => { acc[x] = enabled.includes(x); return acc; }, {} as Record<PlanFeature, boolean>);

const STARTER_FEATURES: PlanFeature[] = ['talentTreasury', 'resumeSearch', 'sourceTracking', 'emailTemplates', 'branding'];
const PRO_FEATURES: PlanFeature[] = [...STARTER_FEATURES, 'interviews', 'myTeam', 'teamFit', 'advancedAnalytics', 'gdprControls'];

export const PLANS: Record<SubscriptionPlan, PlanDef> = {
    free: {
        name: 'Free', price: '$0', priceValue: 0, tagline: 'Get started',
        limits: { maxPositions: 1, maxCandidates: 25, maxSeats: 1 },
        features: f([]),
    },
    starter: {
        name: 'Starter', price: '$99', priceValue: 99, tagline: 'For growing teams',
        limits: { maxPositions: 5, maxCandidates: 250, maxSeats: 3 },
        features: f(STARTER_FEATURES),
    },
    professional: {
        name: 'Professional', price: '$299', priceValue: 299, tagline: 'For scaling recruiters',
        limits: { maxPositions: 25, maxCandidates: 2500, maxSeats: 10 },
        features: f(PRO_FEATURES),
    },
    enterprise: {
        name: 'Enterprise', price: 'Custom', priceValue: 0, tagline: 'For organizations',
        limits: { maxPositions: Infinity, maxCandidates: Infinity, maxSeats: Infinity },
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

export const PLAN_LIMITS = {
    free: { maxPositions: 1, maxCandidates: 25, advancedAnalytics: false, aiInsights: false },
    starter: { maxPositions: 5, maxCandidates: 250, advancedAnalytics: false, aiInsights: false },
    professional: { maxPositions: 25, maxCandidates: 2500, advancedAnalytics: true, aiInsights: true },
    enterprise: { maxPositions: 9999, maxCandidates: 9999, advancedAnalytics: true, aiInsights: true },
} as const;