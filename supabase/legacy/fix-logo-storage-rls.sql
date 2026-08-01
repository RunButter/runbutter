-- FIX: Row Level Security for Company Logos Storage
-- Run this in the Supabase SQL Editor

-- 1. Ensure the 'company-logos' bucket exists and is public
INSERT INTO storage.buckets (id, name, public) 
VALUES ('company-logos', 'company-logos', true)
ON CONFLICT (id) DO NOTHING;

-- 2. Allow public viewing
DROP POLICY IF EXISTS "Public can view company logos" ON storage.objects;
CREATE POLICY "Public can view company logos" ON storage.objects
    FOR SELECT USING (bucket_id = 'company-logos');

-- 3. Allow public uploads to company-logos (Matches candidate-cvs pattern)
-- This is necessary because Privy users are not natively "authenticated" in Supabase Storage.
DROP POLICY IF EXISTS "Recruiters can upload company logo" ON storage.objects;
CREATE POLICY "Recruiters can upload company logo" ON storage.objects
    FOR INSERT WITH CHECK (bucket_id = 'company-logos');

-- 4. Allow any authenticated or public user to update/delete (Matched to candidate-cvs security level)
DROP POLICY IF EXISTS "Recruiters can update/delete own logo" ON storage.objects;
CREATE POLICY "Recruiters can update/delete own logo" ON storage.objects
    FOR ALL USING (bucket_id = 'company-logos');
