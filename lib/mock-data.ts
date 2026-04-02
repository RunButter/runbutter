export const MOCK_CANDIDATES = [
    {
        id: 'mock-1',
        full_name: 'Alexander Chen',
        email: 'alex@example.com',
        phone: '+1 555-0123',
        status: 'hired',
        position_title: 'Senior Software Engineer',
        position_department: 'Engineering',
        position_neuro_profile: 'hard-tech',
        applied_at: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        source: 'LinkedIn',
        linkedin_url: 'https://linkedin.com/in/alexchen',
        assessment_results: [{
            overall_score: 94,
            cognitive_score: 96,
            personality_score: 92,
            work_style_score: 91,
            personality_data: { openness: 88, conscientiousness: 95, extraversion: 45, agreeableness: 60, neuroticism: 15 },
            work_style_data: { collaboration: 70, structure: 90, strategic: 85, innovation: 80 },
            cognitive_data: { logic: 98, patterns: 94, problem_solving: 96 },
            summary: "Exceptional technical talent with high conscientiousness and emotional stability. Perfect match for core infrastructure engineering."
        }]
    },
    {
        id: 'mock-2',
        full_name: 'Sarah Jenkins',
        email: 'sarah@global-sales.com',
        phone: '+1 555-0456',
        status: 'interview_scheduled',
        position_title: 'Enterprise Account Executive',
        position_department: 'Sales',
        position_neuro_profile: 'aggressive-sales',
        applied_at: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
        source: 'Referral',
        linkedin_url: 'https://linkedin.com/in/sjenkins',
        assessment_results: [{
            overall_score: 89,
            cognitive_score: 82,
            personality_score: 94,
            work_style_score: 88,
            personality_data: { openness: 65, conscientiousness: 75, extraversion: 96, agreeableness: 85, neuroticism: 30 },
            work_style_data: { collaboration: 90, structure: 70, strategic: 80, innovation: 65 },
            cognitive_data: { logic: 80, patterns: 85, problem_solving: 82 },
            summary: "Highly extraverted and resilient. Natural rapport builder with strong closing instincts. Fits the aggressive sales profile perfectly."
        }]
    },
    {
        id: 'mock-3',
        full_name: 'Marcus Thorne',
        email: 'm.thorne@design.io',
        phone: '+1 555-0789',
        status: 'screening',
        position_title: 'Product Designer',
        position_department: 'Product',
        position_neuro_profile: 'creative-chaos',
        applied_at: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(),
        source: 'Behance',
        linkedin_url: 'https://linkedin.com/in/mthorne',
        assessment_results: [{
            overall_score: 85,
            cognitive_score: 88,
            personality_score: 82,
            work_style_score: 85,
            personality_data: { openness: 98, conscientiousness: 45, extraversion: 75, agreeableness: 70, neuroticism: 40 },
            work_style_data: { collaboration: 85, structure: 40, strategic: 75, innovation: 95 },
            cognitive_data: { logic: 85, patterns: 92, problem_solving: 88 },
            summary: "Visionary creative with extremely high openness to new ideas. Thrives in ambiguous environments where innovation is prioritized over structure."
        }]
    },
    {
        id: 'mock-4',
        full_name: 'Elena Rodriguez',
        email: 'elena@ops-pro.com',
        phone: '+1 555-0999',
        status: 'applied',
        position_title: 'Operations Manager',
        position_department: 'Operations',
        position_neuro_profile: 'operations-monk',
        applied_at: new Date().toISOString(),
        source: 'Indeed',
        linkedin_url: 'https://linkedin.com/in/erodriguez',
        assessment_results: [{
            overall_score: 91,
            cognitive_score: 85,
            personality_score: 95,
            work_style_score: 92,
            personality_data: { openness: 45, conscientiousness: 98, extraversion: 50, agreeableness: 75, neuroticism: 10 },
            work_style_data: { collaboration: 80, structure: 98, strategic: 70, innovation: 45 },
            cognitive_data: { logic: 88, patterns: 82, problem_solving: 85 },
            summary: "Extremely high attention to detail and emotional stability. A powerhouse for process optimization and operational consistency."
        }]
    },
    {
        id: 'mock-5',
        full_name: 'David Kim',
        email: 'dkim@tech-staffing.com',
        phone: '+1 555-0222',
        status: 'assessment_sent',
        position_title: 'Frontend Developer',
        position_department: 'Engineering',
        position_neuro_profile: 'hard-tech',
        applied_at: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
        source: 'GitHub',
        linkedin_url: 'https://linkedin.com/in/dkim-dev',
        assessment_results: []
    }
];

export const MOCK_STATS = {
    totalCandidates: 124,
    activePositions: 8,
    assessmentsCompleted: 85,
    upcomingInterviews: 12,
    newApplications: 14,
    pendingReview: 18
};

export const MOCK_ACTIVITY = [
    { id: 'a1', action: 'hired', candidate_name: 'Alexander Chen', created_at: new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString() },
    { id: 'a2', action: 'assessment_completed', candidate_name: 'Sarah Jenkins', created_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString() },
    { id: 'a3', action: 'interview_scheduled', candidate_name: 'Marcus Thorne', created_at: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString() },
    { id: 'a4', action: 'application_submitted', candidate_name: 'Elena Rodriguez', created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
];
