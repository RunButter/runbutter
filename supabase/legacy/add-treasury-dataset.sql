-- ============================================================================
-- RunButter :: Module 2 — Talent Treasury dataset (additive, non-breaking)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Provides ONE secure RPC that returns a company's candidates with their
-- latest assessment scores in a single call. The faceted sidebar, sliders,
-- sorting and micro-insights are all computed client-side for instant,
-- zero-reload interaction — so this is the only DB round-trip the page needs.
-- ============================================================================

-- Speeds up the "latest result per candidate" lookup below.
CREATE INDEX IF NOT EXISTS idx_results_candidate_completed
  ON assessment_results (candidate_id, completed_at DESC);

CREATE OR REPLACE FUNCTION get_treasury_dataset(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE
    v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id
    FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;

    IF v_company_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        FROM (
            SELECT
                can.id,
                can.full_name,
                can.email,
                can.phone,
                can.source,
                can.status,
                can.applied_at,
                can.position_id,
                (can.resume_raw_text IS NOT NULL AND length(can.resume_raw_text) > 0) AS has_resume,
                pos.title         AS position_title,
                pos.neuro_profile AS position_neuro_profile,
                (res.id IS NOT NULL) AS has_assessment,
                res.overall_score,
                res.screening_score,
                res.personality_score,
                res.work_style_score,
                res.cognitive_score,
                -- Big-5 sub-scores (kept for richer facets / radar later).
                NULLIF(res.personality_data->>'openness', '')::numeric          AS big5_openness,
                NULLIF(res.personality_data->>'conscientiousness', '')::numeric  AS big5_conscientiousness,
                NULLIF(res.personality_data->>'extraversion', '')::numeric       AS big5_extraversion,
                NULLIF(res.personality_data->>'agreeableness', '')::numeric      AS big5_agreeableness,
                NULLIF(res.personality_data->>'neuroticism', '')::numeric        AS big5_neuroticism
            FROM candidates can
            LEFT JOIN positions pos ON pos.id = can.position_id
            LEFT JOIN LATERAL (
                SELECT *
                FROM assessment_results r
                WHERE r.candidate_id = can.id
                ORDER BY r.completed_at DESC NULLS LAST
                LIMIT 1
            ) res ON true
            WHERE can.company_id = v_company_id
        ) t
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_treasury_dataset(text) TO authenticated, anon;
