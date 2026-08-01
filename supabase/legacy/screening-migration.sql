-- SCREENING QUESTIONS MIGRATION: Run this in Supabase SQL Editor

-- 1. Add screening_score to assessment_results
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='assessment_results' AND COLUMN_NAME='screening_score') THEN
        ALTER TABLE assessment_results ADD COLUMN screening_score INTEGER;
    END IF;
END $$;

-- 2. Add screening_answers to assessment_results
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='assessment_results' AND COLUMN_NAME='screening_answers') THEN
        ALTER TABLE assessment_results ADD COLUMN screening_answers JSONB DEFAULT '[]'::jsonb;
    END IF;
END $$;
