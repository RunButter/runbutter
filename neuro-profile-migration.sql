-- Add Neuro-Profile column to positions
ALTER TABLE positions ADD COLUMN IF NOT EXISTS neuro_profile TEXT CHECK (neuro_profile IN ('hard-tech', 'aggressive-sales', 'creative-chaos', 'operations-monk'));

-- Fix candidate visibility for recruiters
DROP POLICY IF EXISTS "Users can view own company candidates" ON candidates;
CREATE POLICY "Users can view own company candidates" ON candidates
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );
