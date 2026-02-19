export type SubscriptionPlan = 'free' | 'starter' | 'professional' | 'enterprise';

export const PLAN_LIMITS = {
    free: {
        maxPositions: 1,
        maxCandidates: 10,
        advancedAnalytics: false,
        aiInsights: false,
    },
    starter: {
        maxPositions: 5,
        maxCandidates: 100,
        advancedAnalytics: true,
        aiInsights: false,
    },
    professional: {
        maxPositions: 20,
        maxCandidates: 1000,
        advancedAnalytics: true,
        aiInsights: true,
    },
    enterprise: {
        maxPositions: 9999,
        maxCandidates: 9999,
        advancedAnalytics: true,
        aiInsights: true,
    }
} as const;

export function isFeatureAllowed(plan: SubscriptionPlan, feature: keyof typeof PLAN_LIMITS['free']) {
    return PLAN_LIMITS[plan][feature];
}
