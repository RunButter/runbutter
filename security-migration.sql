-- REFINED SECURITY MIGRATION: Fixes assessment results visibility for recruiters
-- Run this in Supabase SQL Editor

-- 1. Ensure access_token exists
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='candidates' AND COLUMN_NAME='access_token') THEN
        ALTER TABLE candidates ADD COLUMN access_token UUID DEFAULT uuid_generate_v4();
    END IF;
END $$;

-- 2. Simplify candidates access policy for tokens
DROP POLICY IF EXISTS "Candidates can access own record" ON candidates;
CREATE POLICY "Candidates can access own record" ON candidates
    FOR ALL USING (
        access_token::text = current_setting('app.candidate_access_token', true)
    );

-- 3. REFINED: Clearer assessment_results policy using EXISTS
-- This avoids deep IN subqueries and relies on the related table's RLS
DROP POLICY IF EXISTS "Users can view own company assessment results" ON assessment_results;
CREATE POLICY "Users can view own company assessment results" ON assessment_results
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM candidates 
            WHERE candidates.id = assessment_results.candidate_id
            AND (
                -- Option A: Recruiter/Admin can see the candidate
                candidates.company_id IN (
                    SELECT company_id FROM company_users 
                    WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
                    OR auth_user_id = auth.uid()
                )
                OR
                -- Option B: This is the candidate themselves
                candidates.access_token::text = current_setting('app.candidate_access_token', true)
            )
        )
    );

-- 4. Broaden INSERT policy for results (Allow recruiters to generate demo data)
DROP POLICY IF EXISTS "Public can insert assessment results" ON assessment_results;
CREATE POLICY "Authorized insert assessment results" ON assessment_results
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM candidates 
            WHERE candidates.id = assessment_results.candidate_id
            AND (
                 -- Option A: Recruiter/Admin
                 candidates.company_id IN (
                    SELECT company_id FROM company_users 
                    WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
                    OR auth_user_id = auth.uid()
                )
                OR
                -- Option B: Valid Candidate token
                candidates.access_token::text = current_setting('app.candidate_access_token', true)
            )
        )
    );

-- 5. Harden activity_log SELECT (it was previously too permissive)
DROP POLICY IF EXISTS "Users can view own company activity logs" ON activity_log;
CREATE POLICY "Users can view own company activity logs" ON activity_log
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );
