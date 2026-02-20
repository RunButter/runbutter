-- Run this in the Supabase SQL Editor to fix the assessment results table
-- This ensures all columns required by the dashboard exist

-- 1. Add missing columns to 'assessment_results' if they don't exist
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS cognitive_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS personality_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS work_style_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS personality_data JSONB;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS work_style_data JSONB;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS cognitive_data JSONB;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();

-- 2. Ensure RLS is enabled
ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;

-- 3. Update/Recreate policies to be safe
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
