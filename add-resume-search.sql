-- ============================================================================
-- HireBTR :: Module 1 — Zero-cost resume search (additive, non-breaking)
-- Run this in the Supabase SQL Editor. Safe to re-run (idempotent).
--
-- Adds raw resume text + a generated tsvector + GIN index to `candidates`,
-- and a search RPC that mirrors get_candidates_for_recruiter() but filters
-- and ranks by native Postgres Full-Text Search. No LLM tokens involved.
-- ============================================================================

-- 1) Raw extracted CV text (filled server-side by pdf-parse / mammoth).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_raw_text text;

-- 2) Generated FTS vector. 'simple' config keeps tech tokens intact
--    (React stays React, no stemming) and works for mixed PL/EN content.
--    Generated + STORED so it stays in sync automatically and is indexable.
ALTER TABLE candidates
  ADD COLUMN IF NOT EXISTS resume_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', coalesce(resume_raw_text, ''))) STORED;

-- 3) GIN index = single-digit-ms Boolean queries across tens of thousands of rows.
CREATE INDEX IF NOT EXISTS idx_candidates_resume_tsv ON candidates USING gin (resume_tsv);

-- Optional: track when text was last extracted (useful for backfill / re-parse).
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS resume_parsed_at timestamptz;

-- ----------------------------------------------------------------------------
-- 4) SECURE RPC: search candidates for a recruiter by Boolean keyword query.
--    Mirrors get_candidates_for_recruiter() exactly (same return shape) so the
--    dashboard can swap between them with no mapping changes.
--
--    p_query uses websearch syntax (injection-safe, never throws):
--       react node           -> react AND node
--       react or vue         -> react OR vue
--       react -junior        -> react AND NOT junior
--       "node.js"            -> exact phrase
--    Empty/null query -> returns all company candidates (same as the list view).
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION search_candidates_for_recruiter(
    p_privy_user_id text,
    p_query text DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_company_id UUID;
    v_query      tsquery;
    v_q          text := nullif(btrim(coalesce(p_query, '')), '');
BEGIN
    SELECT company_id INTO v_company_id
    FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;

    IF v_company_id IS NULL THEN
        RETURN '[]'::jsonb;
    END IF;

    -- No query -> behave like the plain list (most recent first).
    IF v_q IS NULL THEN
        RETURN (
            SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
            FROM (
                SELECT can.*,
                       pos.title AS position_title,
                       0::real   AS keyword_density,
                       (SELECT jsonb_agg(res ORDER BY completed_at DESC)
                          FROM assessment_results res WHERE res.candidate_id = can.id) AS assessment_results
                FROM candidates can
                LEFT JOIN positions pos ON can.position_id = pos.id
                WHERE can.company_id = v_company_id
                ORDER BY can.applied_at DESC
            ) c
        );
    END IF;

    -- websearch_to_tsquery is safe against arbitrary user input.
    v_query := websearch_to_tsquery('simple', v_q);

    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(c)), '[]'::jsonb)
        FROM (
            SELECT can.*,
                   pos.title AS position_title,
                   ts_rank(can.resume_tsv, v_query) AS keyword_density,
                   (SELECT jsonb_agg(res ORDER BY completed_at DESC)
                      FROM assessment_results res WHERE res.candidate_id = can.id) AS assessment_results
            FROM candidates can
            LEFT JOIN positions pos ON can.position_id = pos.id
            WHERE can.company_id = v_company_id
              AND (
                    can.resume_tsv @@ v_query          -- resume keyword hit
                 OR can.full_name ILIKE '%' || v_q || '%'   -- still match name
                 OR can.email     ILIKE '%' || v_q || '%'   -- ...and email
              )
            -- best keyword fit first, then most recent
            ORDER BY ts_rank(can.resume_tsv, v_query) DESC, can.applied_at DESC
        ) c
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_candidates_for_recruiter(text, text) TO authenticated, anon;
