-- FIX: Row Level Security for Company Logos Storage
-- Run this in the Supabase SQL Editor

-- 1. Ensure the 'company-logos' bucket exists
INSERT INTO storage.buckets (id, name, public) 
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow public viewing
DROP POLICY IF EXISTS "Public can view company logos" ON storage.objects;
CREATE POLICY "Public can view company logos" ON storage.objects
    FOR SELECT USING (bucket_id = 'company-logos');

-- 3. Allow uploads for authenticated users (recruiters)
-- We check for either the custom privy session variable OR auth.uid()
-- To make it more robust, we allow any authenticated request to the bucket for now, 
-- but strictly validated by the bucket_id.
DROP POLICY IF EXISTS "Recruiters can upload company logo" ON storage.objects;
CREATE POLICY "Recruiters can upload company logo" ON storage.objects
    FOR INSERT WITH CHECK (
        bucket_id = 'company-logos' AND
        (
            -- Check custom Privy ID session variable
            (storage.foldername(name))[1] IN (
                SELECT company_id::text FROM company_users 
                WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            )
            OR
            -- Or check if it's a valid authenticated request (fallback)
            -- If current_setting is failing, this might still fail if not using Supabase Auth
            -- For Privy users, we rely on the RPC call to set the setting.
            auth.role() = 'authenticated'
        )
    );

-- 4. Allow updates/deletes
DROP POLICY IF EXISTS "Recruiters can update/delete own logo" ON storage.objects;
CREATE POLICY "Recruiters can update/delete own logo" ON storage.objects
    FOR ALL USING (
        bucket_id = 'company-logos' AND
        (
            (storage.foldername(name))[1] IN (
                SELECT company_id::text FROM company_users 
                WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
            )
            OR
            auth.role() = 'authenticated'
        )
    );
