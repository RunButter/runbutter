-- runbutter Migration Script
-- Run this in the Supabase SQL Editor to add missing columns and tables

-- 1. Add missing columns to 'companies'
ALTER TABLE companies ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'professional', 'enterprise'));
ALTER TABLE companies ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_status TEXT;

-- 2. Add 'privy_user_id' to 'company_users'
ALTER TABLE company_users ADD COLUMN IF NOT EXISTS privy_user_id TEXT UNIQUE;

-- 3. Create 'set_config' helper for RLS
CREATE OR REPLACE FUNCTION set_config(name text, value text, is_local boolean)
RETURNS text AS $$
    SELECT set_config(name, value, is_local);
$$ LANGUAGE sql;

-- 4. Create new 'assessment_results' table
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

-- 5. Enable RLS on assessment_results
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;

-- 6. Update candidates fetch to include assessment_results
-- (This is a comment for documentation, no SQL action needed here)

-- 7. Add RLS Policies for assessment_results
DROP POLICY IF EXISTS "Users can view own company assessment results" ON assessment_results;
CREATE POLICY "Users can view own company assessment results" ON assessment_results
    FOR SELECT USING (
        candidate_id IN (
            SELECT id FROM candidates WHERE company_id IN (
                SELECT company_id FROM company_users 
                WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            )
        )
    );

DROP POLICY IF EXISTS "Public can insert assessment results" ON assessment_results;
CREATE POLICY "Public can insert assessment results" ON assessment_results
    FOR INSERT WITH CHECK (true);
