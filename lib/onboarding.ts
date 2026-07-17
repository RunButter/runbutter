// Rule-based onboarding "copilot" — generates a manager brief and a tailored
// onboarding checklist purely from a hire's psychometric scores.
// Deterministic and free: NO LLM / API calls (per RunButter's cost model).

export interface TraitInput {
    full_name?: string;
    personality_data?: {
        openness?: number;
        conscientiousness?: number;
        extraversion?: number;
        agreeableness?: number;
        neuroticism?: number;
    } | null;
    work_style_data?: {
        collaboration?: number;
        structure?: number;
        strategic?: number;
        innovation?: number;
    } | null;
}

export interface ChecklistItem {
    key: string;
    title: string;
}

const firstName = (name?: string) => (name || 'This hire').trim().split(' ')[0];

/**
 * Generates a manager-facing onboarding brief as a list of practical points.
 */
export function generateBrief(member: TraitInput): string[] {
    const p = member.personality_data || {};
    const w = member.work_style_data || {};
    const name = firstName(member.full_name);
    const out: string[] = [];

    const O = p.openness, C = p.conscientiousness, E = p.extraversion, A = p.agreeableness, N = p.neuroticism;

    if (C != null && C >= 65)
        out.push(`${name} is highly conscientious — thrives with clear structure, documented tasks, and defined deadlines. Give a written Week-1 plan with explicit priorities.`);
    if (C != null && C < 40)
        out.push(`${name} scores lower on structure — give outcomes and autonomy rather than rigid step-by-step processes, and check in on progress proactively.`);

    if (N != null && N >= 60)
        out.push(`${name} is sensitive to chaotic or ambiguous environments. Avoid shifting deadlines and last-minute changes in the first weeks; keep expectations stable and reassuring.`);
    if (N != null && N < 35)
        out.push(`${name} is emotionally steady under pressure — comfortable being handed ambiguous or high-stakes work early.`);

    if (E != null && E < 40)
        out.push(`${name} leans introverted — prefers focused solo work and async communication. Keep Week-1 meetings light and share context in writing.`);
    if (E != null && E >= 65)
        out.push(`${name} is energized by people and collaboration. Pair them up, give visibility, and use verbal feedback and team intros.`);

    if (O != null && O >= 65)
        out.push(`${name} is highly open — give a novel or exploratory problem early to keep them engaged, and allow room to suggest improvements.`);
    if (O != null && O < 40)
        out.push(`${name} prefers proven, well-defined methods — lean on documented processes rather than open-ended ambiguity at first.`);

    if (A != null && A >= 65)
        out.push(`${name} is highly agreeable and team-oriented but may avoid conflict — proactively invite their honest opinion so concerns surface early.`);
    if (A != null && A < 40)
        out.push(`${name} is direct and candid — give clear rationale for decisions and expect (healthy) pushback.`);

    if (w.collaboration != null && w.collaboration >= 70)
        out.push(`Work style skews collaborative — embed them in a pod or pairing setup rather than isolating them.`);
    if (w.structure != null && w.structure >= 70)
        out.push(`Prefers highly structured work — provide checklists, runbooks, and clear ownership.`);
    if (w.strategic != null && w.strategic >= 70)
        out.push(`Strategic thinker — share the "why" and longer-term roadmap, not just the immediate task.`);
    if (w.innovation != null && w.innovation >= 70)
        out.push(`Creative/innovation-leaning — give space to propose and prototype new ideas.`);

    if (out.length === 0)
        out.push(`${name} has a balanced profile — a standard structured onboarding with regular check-ins should work well.`);

    return out;
}

/**
 * Generates a tailored onboarding checklist. Stable `key`s let completion
 * state persist in the onboarding_tasks table.
 */
export function generateChecklist(member: TraitInput): ChecklistItem[] {
    const p = member.personality_data || {};
    const w = member.work_style_data || {};
    const items: ChecklistItem[] = [
        { key: 'access', title: 'Set up accounts, tools & access' },
        { key: 'intro_1on1', title: 'Intro 1:1 with direct manager' },
        { key: 'buddy', title: 'Assign an onboarding buddy' },
        { key: 'week1_goals', title: 'Share a written Week-1 goals doc' },
    ];

    const C = p.conscientiousness, E = p.extraversion, O = p.openness, N = p.neuroticism;

    if ((N != null && N >= 60) || (C != null && C >= 65))
        items.push({ key: 'structured_plan', title: 'Provide a fixed, written Week-1 plan with explicit priorities' });
    if (E != null && E < 40)
        items.push({ key: 'async_first', title: 'Keep meetings minimal; share context async in docs' });
    if (E != null && E >= 65)
        items.push({ key: 'team_intros', title: 'Schedule team intros / informal lunch' });
    if (O != null && O >= 65)
        items.push({ key: 'creative_task', title: 'Hand off one exploratory/creative task by Day 5' });
    if (C != null && C >= 65)
        items.push({ key: 'docs', title: 'Share detailed documentation & runbooks' });
    if (w.strategic != null && w.strategic >= 70)
        items.push({ key: 'roadmap', title: 'Walk through the team roadmap and the "why"' });

    items.push({ key: 'pulse_setup', title: 'Set expectation for weekly pulse check-in' });
    return items;
}

/** A short, human label for a team's aggregated "vibe" from average Big-5. */
export function vibeLabel(avg: { extraversion: number; agreeableness: number; conscientiousness: number; openness: number }): string {
    const tags: string[] = [];
    if (avg.extraversion >= 60) tags.push('Extroverted'); else if (avg.extraversion < 40) tags.push('Introverted');
    if (avg.conscientiousness >= 60) tags.push('High-structure');
    if (avg.openness >= 60) tags.push('Exploratory');
    if (avg.agreeableness >= 60) tags.push('People-first');
    return tags.length ? tags.join(' · ') : 'Balanced';
}
