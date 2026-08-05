-- 0. SCHEMA UPDATES: Ensure assessment_results has ALL required columns and correct names
-- We standardize on the column names used in the application code.
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS overall_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS personality_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS personality_data JSONB;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS work_style_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS work_style_data JSONB;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS cognitive_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS cognitive_data JSONB;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS summary TEXT;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS screening_score INTEGER;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS screening_answers JSONB;
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW();
ALTER TABLE assessment_results ADD COLUMN IF NOT EXISTS assessment_response_id UUID REFERENCES assessment_responses(id) ON DELETE CASCADE;

-- Also check if plural names exist and we can alias them if needed, but adding columns is safer
-- for the existing queries in the app.

-- 1. DATA MIGRATION: Update existing templates to have 20 personality questions
-- We do this to fix positions that only have 2 questions currently.
UPDATE assessment_templates
SET questions = (
    SELECT jsonb_agg(sub.item)
    FROM (
        SELECT value AS item FROM jsonb_array_elements('[
            {"id": "b5_o1", "text": "I have a vivid imagination.", "type": "scale", "trait": "Openness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_o2", "text": "I am interested in abstract ideas.", "type": "scale", "trait": "Openness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_o3", "text": "I enjoy thinking about new ways of doing things.", "type": "scale", "trait": "Openness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_o4", "text": "I am full of ideas.", "type": "scale", "trait": "Openness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_c1", "text": "I am always prepared.", "type": "scale", "trait": "Conscientiousness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_c2", "text": "I pay attention to details.", "type": "scale", "trait": "Conscientiousness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_c3", "text": "I like order.", "type": "scale", "trait": "Conscientiousness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_c4", "text": "I follow a schedule.", "type": "scale", "trait": "Conscientiousness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_e1", "text": "I am the life of the party.", "type": "scale", "trait": "Extraversion", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_e2", "text": "I feel comfortable around people.", "type": "scale", "trait": "Extraversion", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_e3", "text": "I start conversations.", "type": "scale", "trait": "Extraversion", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_e4", "text": "I talk to a lot of different people at parties.", "type": "scale", "trait": "Extraversion", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_a1", "text": "I am interested in people.", "type": "scale", "trait": "Agreeableness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_a2", "text": "I sympathize with others'' feelings.", "type": "scale", "trait": "Agreeableness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_a3", "text": "I have a soft heart.", "type": "scale", "trait": "Agreeableness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_a4", "text": "I take time out for others.", "type": "scale", "trait": "Agreeableness", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_n1", "text": "I get stressed out easily.", "type": "scale", "trait": "Neuroticism", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_n2", "text": "I worry about things.", "type": "scale", "trait": "Neuroticism", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_n3", "text": "I am easily disturbed.", "type": "scale", "trait": "Neuroticism", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"},
            {"id": "b5_n4", "text": "I change my mood a lot.", "type": "scale", "trait": "Neuroticism", "options": ["Strongly Disagree", "Disagree", "Neutral", "Agree", "Strongly Agree"], "category": "personality"}
        ]'::jsonb)
        UNION ALL
        -- Keep existing custom screening questions
        SELECT value FROM jsonb_array_elements(assessment_templates.questions)
        WHERE value->>'category' = 'screening'
    ) sub
)
WHERE is_default = true;

-- 2. SECURE RPC: Fetch candidates for a recruiter
CREATE OR REPLACE FUNCTION get_candidates_for_recruiter(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE
    v_company_id UUID;
BEGIN
    -- Get company ID for the user
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    
    IF v_company_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    -- Return candidates with their results
    RETURN (
        SELECT jsonb_agg(row_to_json(c))
        FROM (
            SELECT 
                can.*,
                pos.title as position_title,
                (
                    SELECT jsonb_agg(res ORDER BY completed_at DESC) 
                    FROM assessment_results res 
                    WHERE res.candidate_id = can.id
                ) as assessment_results
            FROM candidates can
            LEFT JOIN positions pos ON can.position_id = pos.id
            WHERE can.company_id = v_company_id
            ORDER BY can.applied_at DESC
        ) c
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. SECURE RPC: Submit assessment
CREATE OR REPLACE FUNCTION submit_assessment(
    p_candidate_id UUID,
    p_token UUID,
    p_results JSONB,
    p_answers JSONB
)
RETURNS boolean AS $$
DECLARE
    v_valid_candidate BOOLEAN;
    v_response_id UUID;
    v_company_id UUID;
    v_position_id UUID;
    v_template_id UUID;
BEGIN
    -- Verify token and get candidate info
    SELECT company_id, position_id INTO v_company_id, v_position_id 
    FROM candidates 
    WHERE id = p_candidate_id AND access_token = p_token;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'Invalid token or candidate ID';
    END IF;

    -- Get the template ID for this position (default one)
    SELECT id INTO v_template_id 
    FROM assessment_templates 
    WHERE position_id = v_position_id AND is_default = true 
    LIMIT 1;

    -- Insert into assessment_responses
    INSERT INTO assessment_responses (candidate_id, assessment_template_id, answers, is_completed, completed_at)
    VALUES (p_candidate_id, v_template_id, p_answers, true, NOW())
    RETURNING id INTO v_response_id;

    -- Insert into assessment_results
    INSERT INTO assessment_results (
        candidate_id, 
        assessment_response_id, 
        overall_score, 
        personality_score,
        work_style_score,
        cognitive_score,
        personality_data,
        work_style_data,
        cognitive_data,
        summary,
        screening_score,
        screening_answers,
        completed_at
    )
    VALUES (
        p_candidate_id,
        v_response_id,
        COALESCE((p_results->>'overall_score')::int, 0),
        COALESCE((p_results->>'personality_score')::int, 0),
        COALESCE((p_results->>'work_style_score')::int, 0),
        COALESCE((p_results->>'cognitive_score')::int, 0),
        COALESCE(p_results->'personality_data', '{}'::jsonb),
        COALESCE(p_results->'work_style_data', '{}'::jsonb),
        COALESCE(p_results->'cognitive_data', '{}'::jsonb),
        COALESCE(p_results->>'summary', ''),
        COALESCE((p_results->>'screening_score')::int, 0),
        COALESCE(p_results->'screening_answers', '[]'::jsonb),
        NOW()
    );

    -- Update candidate status
    UPDATE candidates SET status = 'assessment_completed', updated_at = NOW() WHERE id = p_candidate_id;

    -- Log activity
    INSERT INTO activity_log (company_id, candidate_id, action, details)
    VALUES (v_company_id, p_candidate_id, 'assessment_completed', p_results);

    RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. SECURE RPC: Fetch single candidate details
CREATE OR REPLACE FUNCTION get_candidate_details(p_candidate_id UUID, p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE
    v_company_id UUID;
    v_candidate_rec RECORD;
    v_actual_company_id UUID;
BEGIN
    -- 1. Verify the recruiter exists and get their company_id
    SELECT cu.company_id INTO v_company_id 
    FROM company_users cu 
    WHERE cu.privy_user_id = p_privy_user_id LIMIT 1;

    IF v_company_id IS NULL THEN
        RAISE EXCEPTION 'RECRUITER_NOT_FOUND: No company linked to privy user ID %', p_privy_user_id;
    END IF;

    -- 2. Check if candidate exists at all and which company they belong to
    SELECT company_id INTO v_actual_company_id FROM candidates WHERE id = p_candidate_id;
    
    IF v_actual_company_id IS NULL THEN
        RAISE EXCEPTION 'CANDIDATE_NOT_FOUND: No candidate found with ID %', p_candidate_id;
    END IF;

    IF v_actual_company_id != v_company_id THEN
        RAISE EXCEPTION 'ACCESS_DENIED: Candidate belongs to company % but recruiter belongs to company %', v_actual_company_id, v_company_id;
    END IF;

    -- 3. Fetch candidate details
    SELECT 
        can.*,
        pos.title as position_title,
        pos.department as position_department,
        pos.neuro_profile as position_neuro_profile,
        pos.created_by as position_created_by,
        (
            SELECT jsonb_agg(res ORDER BY completed_at DESC) 
            FROM assessment_results res 
            WHERE res.candidate_id = can.id 
        ) as assessment_results
    INTO v_candidate_rec
    FROM candidates can
    LEFT JOIN positions pos ON can.position_id = pos.id
    WHERE can.id = p_candidate_id AND can.company_id = v_company_id;

    RETURN row_to_json(v_candidate_rec);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4b. Ensure proper permissions for all Secure RPCs
GRANT EXECUTE ON FUNCTION get_candidates_for_recruiter(text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_candidate_details(UUID, text) TO authenticated, anon;
-- get_assessment_init_data and submit_assessment are GRANTED at the bottom of
-- this file, after they are created. They used to be granted here, four lines
-- before the CREATE — which only ever worked because a previous hand-run had
-- already created them. On a genuinely fresh database it failed on the first
-- statement, which is exactly the case scripts/migrate.mjs exists to serve.

-- 5. SECURE RPC: Initialize Assessment Page (Single Call)
CREATE OR REPLACE FUNCTION get_assessment_init_data(p_candidate_id UUID, p_token UUID)
RETURNS jsonb AS $$
DECLARE
    v_candidate_rec RECORD;
    v_company_rec RECORD;
    v_template_rec RECORD;
    v_result JSONB;
BEGIN
    -- 1. Get Candidate & Check Token
    SELECT * INTO v_candidate_rec 
    FROM candidates 
    WHERE id = p_candidate_id AND access_token = p_token;

    IF v_candidate_rec.id IS NULL THEN
        RETURN NULL;
    END IF;

    -- 2. Get Company Info
    SELECT name, logo_url INTO v_company_rec 
    FROM companies 
    WHERE id = v_candidate_rec.company_id;

    -- 3. Get Template
    SELECT * INTO v_template_rec 
    FROM assessment_templates 
    WHERE position_id = v_candidate_rec.position_id AND is_default = true
    LIMIT 1;

    -- 4. Package Response
    v_result := jsonb_build_object(
        'candidate', row_to_json(v_candidate_rec),
        'company', row_to_json(v_company_rec),
        'template', row_to_json(v_template_rec)
    );

    RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Deferred from section 4b — see the note there.
GRANT EXECUTE ON FUNCTION get_assessment_init_data(UUID, UUID) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION submit_assessment(UUID, UUID, JSONB, JSONB) TO authenticated, anon;
