-- Allow public users (candidates) to see company name and logo
-- This is necessary for the application form to show branding
CREATE POLICY "Public can view company branding" ON companies
    FOR SELECT USING (true);

-- NOTE: Since Supabase doesn't support column-level RLS easily, 
-- we use 'true' but the application queries only name and logo_url.
-- For maximum security, you could restrict to companies with active positions:
-- USING (id IN (SELECT company_id FROM positions WHERE is_active = true))
