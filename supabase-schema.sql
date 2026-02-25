-- TalentInsight Database Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Companies table (multi-tenant)
CREATE TABLE companies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    subdomain TEXT UNIQUE NOT NULL,
    logo_url TEXT,
    brand_color TEXT DEFAULT '#4F46E5',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    settings JSONB DEFAULT '{}'::jsonb,
    plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'professional', 'enterprise')),
    stripe_customer_id TEXT,
    subscription_status TEXT,
    is_active BOOLEAN DEFAULT true
);

-- Company admins/users
CREATE TABLE company_users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role TEXT DEFAULT 'admin' CHECK (role IN ('owner', 'admin', 'recruiter', 'viewer')),
    auth_user_id UUID, -- Supabase auth.users id (deprecated)
    privy_user_id TEXT UNIQUE, -- Privy user id
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    UNIQUE(company_id, email)
);

-- Job positions
CREATE TABLE positions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    department TEXT,
    location TEXT,
    employment_type TEXT CHECK (employment_type IN ('full-time', 'part-time', 'contract', 'internship')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES company_users(id)
);

-- Assessment templates (customizable per role)
CREATE TABLE assessment_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    position_id UUID REFERENCES positions(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    description TEXT,
    questions JSONB NOT NULL, -- Array of question objects
    scoring_weights JSONB DEFAULT '{}'::jsonb,
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Candidates/Applications
CREATE TABLE candidates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    position_id UUID REFERENCES positions(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT NOT NULL,
    phone TEXT,
    linkedin_url TEXT,
    cv_url TEXT, -- Stored in Supabase Storage
    status TEXT DEFAULT 'applied' CHECK (status IN ('applied', 'screening', 'assessment_sent', 'assessment_completed', 'interview_scheduled', 'interviewed', 'offered', 'rejected', 'hired')),
    applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    notes TEXT,
    source TEXT, -- where they came from (linkedin, direct, referral, etc)
    access_token UUID DEFAULT uuid_generate_v4(), -- Secret token for candidate access
    UNIQUE(company_id, position_id, email)
);

-- Assessment responses
CREATE TABLE assessment_responses (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    assessment_template_id UUID REFERENCES assessment_templates(id) ON DELETE CASCADE,
    answers JSONB NOT NULL, -- Array of answer objects
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    completed_at TIMESTAMP WITH TIME ZONE,
    time_taken_seconds INTEGER,
    is_completed BOOLEAN DEFAULT false
);

-- Assessment results/scores
CREATE TABLE assessment_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    assessment_response_id UUID REFERENCES assessment_responses(id) ON DELETE CASCADE,
    overall_score INTEGER,
    personality_scores JSONB, -- Big 5 scores
    work_style_scores JSONB,
    cognitive_scores JSONB,
    calculated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    insights JSONB -- AI-generated insights
);

-- Interviews
CREATE TABLE interviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    interviewer_id UUID REFERENCES company_users(id),
    scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
    duration_minutes INTEGER DEFAULT 60,
    google_calendar_event_id TEXT,
    google_meet_link TEXT,
    status TEXT DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
    notes TEXT,
    feedback JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Activity log (audit trail)
CREATE TABLE activity_log (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES company_users(id) ON DELETE SET NULL,
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Google Calendar integration tokens
CREATE TABLE integration_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id UUID REFERENCES companies(id) ON DELETE CASCADE,
    user_id UUID REFERENCES company_users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'microsoft', 'linkedin')),
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    scope TEXT[],
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, provider)
);

-- Indexes for performance
CREATE INDEX idx_companies_subdomain ON companies(subdomain);
CREATE INDEX idx_company_users_company ON company_users(company_id);
CREATE INDEX idx_candidates_company_position ON candidates(company_id, position_id);
CREATE INDEX idx_candidates_status ON candidates(status);
CREATE INDEX idx_interviews_scheduled ON interviews(scheduled_at);
CREATE INDEX idx_activity_log_company ON activity_log(company_id);

-- Row Level Security (RLS) Policies
ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE interviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_tokens ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Users can only see their company's data
CREATE POLICY "Users can view own company" ON companies
    FOR SELECT USING (
        id IN (
            SELECT company_id FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view own company users" ON company_users
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );

CREATE POLICY "Users can view own company positions" ON positions
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );

CREATE POLICY "Public can view positions" ON positions
    FOR SELECT USING (true);

CREATE POLICY "Users can view own company candidates" ON candidates
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );

CREATE POLICY "Public can insert candidates" ON candidates
    FOR INSERT WITH CHECK (true);

-- HARDENED: Only the candidate with the correct token can select/update their own record
CREATE POLICY "Candidates can access own record" ON candidates
    FOR ALL USING (
        access_token::text = current_setting('app.candidate_access_token', true)
    );

CREATE POLICY "Public can insert activity log" ON activity_log
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can view own company activity logs" ON activity_log
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );

-- Functions
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION set_config(name text, value text, is_local boolean)
RETURNS text AS $$
    SELECT set_config(name, value, is_local);
$$ LANGUAGE sql;

-- Triggers for updated_at
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON companies
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_positions_updated_at BEFORE UPDATE ON positions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_candidates_updated_at BEFORE UPDATE ON candidates
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Storage policies for CV uploads
-- Enable RLS on storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- Allow public/anon to upload to candidate-cvs
CREATE POLICY "Allow public CV upload" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'candidate-cvs');

-- Allow recruiters or the candidate with the matching token to view CVs
CREATE POLICY "Allow authorized view of CVs" ON storage.objects
    FOR SELECT USING (
        bucket_id = 'candidate-cvs' AND
        (
            -- Option 1: Recruiter from the same company
            (SELECT company_id FROM company_users 
             WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
             OR auth_user_id = auth.uid()) IS NOT NULL
            OR
            -- Option 2: The candidate themselves using their access token
            -- We assume the filename contains the candidate_id (as per uploadCV logic)
            (storage.foldername(name))[1] IN (
                SELECT id::text FROM candidates 
                WHERE access_token::text = current_setting('app.candidate_access_token', true)
            )
        )
    );

-- Assessment Results Table (if not exists)
CREATE TABLE IF NOT EXISTS assessment_results (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    candidate_id UUID REFERENCES candidates(id) ON DELETE CASCADE,
    overall_score INTEGER,
    cognitive_score INTEGER,
    personality_score INTEGER,
    work_style_score INTEGER,
    personality_data JSONB, -- Big 5: { openness: 80, ... }
    work_style_data JSONB, -- { collaboration: 75, ... }
    cognitive_data JSONB,
    summary TEXT, -- AI generated summary
    completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company assessment results" ON assessment_results
    FOR SELECT USING (
        candidate_id IN (
            SELECT id FROM candidates WHERE company_id IN (
                SELECT company_id FROM company_users 
                WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
                OR auth_user_id = auth.uid()
            )
            OR access_token::text = current_setting('app.candidate_access_token', true)
        )
    );

CREATE POLICY "Public can insert assessment results" ON assessment_results
    FOR INSERT WITH CHECK (
        candidate_id IN (
            SELECT id FROM candidates 
            WHERE access_token::text = current_setting('app.candidate_access_token', true)
        )
    );
