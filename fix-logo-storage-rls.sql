-- FIX: Row Level Security for Company Logos Storage
-- Run this in the Supabase SQL Editor

-- 1. Ensure the 'company-logos' bucket exists
INSERT INTO storage.buckets (id, name, public) 
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- NOTE: If you get "must be owner of table objects", it means RLS is likely 
-- already enabled and you may need to manage policies via the Dashboard UI 
-- or ensure you are running this as a project admin.

-- 2. Allow public users to view company logos
-- If this fails with "must be owner", please create these policies manually in the 
-- Supabase Dashboard -> Storage -> Policies section.
DROP POLICY IF EXISTS "Public can view company logos" ON storage.objects;
CREATE POLICY "Public can view company logos" ON storage.objects
    FOR SELECT USING (bucket_id = 'company-logos');

-- 3. Allow authenticated recruiters to upload their company logo
DROP POLICY IF EXISTS "Recruiters can upload company logo" ON storage.objects;
CREATE POLICY "Recruiters can upload company logo" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'company-logos' AND
        (storage.foldername(name))[1] IN (
            SELECT company_id::text FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );

-- 4. Allow recruiters to update or delete their company logo
DROP POLICY IF EXISTS "Recruiters can update/delete own logo" ON storage.objects;
CREATE POLICY "Recruiters can update/delete own logo" ON storage.objects
    FOR ALL USING (
        bucket_id = 'company-logos' AND
        (storage.foldername(name))[1] IN (
            SELECT company_id::text FROM company_users 
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            OR auth_user_id = auth.uid()
        )
    );
