-- ============================================================================
-- HireBTR :: Module 3 — Source Tracking & Attribution (additive, non-breaking)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Adds per-position tracking links (with UTM defaults + click counts), captures
-- UTM params + referrer on each candidate, and exposes RPCs to generate links,
-- list their performance, register clicks, and summarise source attribution.
-- ============================================================================

-- 1) Tracking links: one+ shareable link per position, each with a short token.
CREATE TABLE IF NOT EXISTS tracking_links (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
    position_id  uuid REFERENCES positions(id) ON DELETE CASCADE,
    token        text UNIQUE NOT NULL DEFAULT substr(replace(uuid_generate_v4()::text, '-', ''), 1, 12),
    label        text,
    source       text,             -- channel: linkedin, indeed, pracuj_pl, referral, ...
    utm_source   text,
    utm_medium   text,
    utm_campaign text,
    click_count  integer NOT NULL DEFAULT 0,
    is_active    boolean NOT NULL DEFAULT true,
    created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tracking_links_company  ON tracking_links(company_id);
CREATE INDEX IF NOT EXISTS idx_tracking_links_position ON tracking_links(position_id);

-- 2) Attribution columns on the applicant row.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS utm_source   text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS utm_medium   text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS utm_campaign text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS referrer     text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS tracking_link_id uuid REFERENCES tracking_links(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidates_source        ON candidates(company_id, source);
CREATE INDEX IF NOT EXISTS idx_candidates_tracking_link ON candidates(tracking_link_id);

-- 3) RLS (writes go through SECURITY DEFINER RPCs; this guards direct reads).
ALTER TABLE tracking_links ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Company can view tracking links" ON tracking_links;
CREATE POLICY "Company can view tracking links" ON tracking_links
    FOR SELECT USING (
        company_id IN (
            SELECT company_id FROM company_users
            WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
               OR auth_user_id = auth.uid()
        )
    );

-- 4) Create a tracking link (recruiter-owned position only).
CREATE OR REPLACE FUNCTION create_tracking_link(
    p_privy_user_id text,
    p_position_id   uuid,
    p_label         text,
    p_source        text,
    p_utm_source    text,
    p_utm_medium    text,
    p_utm_campaign  text
)
RETURNS jsonb AS $$
DECLARE
    v_company_id uuid;
    v_pos_company uuid;
    v_row tracking_links;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;

    SELECT company_id INTO v_pos_company FROM positions WHERE id = p_position_id;
    IF v_pos_company IS NULL OR v_pos_company <> v_company_id THEN
        RAISE EXCEPTION 'POSITION_NOT_FOUND_OR_FORBIDDEN';
    END IF;

    INSERT INTO tracking_links (company_id, position_id, label, source, utm_source, utm_medium, utm_campaign)
    VALUES (v_company_id, p_position_id, NULLIF(p_label, ''), NULLIF(p_source, ''),
            NULLIF(p_utm_source, ''), NULLIF(p_utm_medium, ''), NULLIF(p_utm_campaign, ''))
    RETURNING * INTO v_row;

    RETURN row_to_json(v_row);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5) List a company's tracking links with click + applicant counts.
CREATE OR REPLACE FUNCTION get_tracking_links(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RETURN '[]'::jsonb; END IF;

    RETURN (
        SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.created_at DESC), '[]'::jsonb)
        FROM (
            SELECT tl.*,
                   pos.title AS position_title,
                   (SELECT count(*) FROM candidates c WHERE c.tracking_link_id = tl.id) AS applicant_count
            FROM tracking_links tl
            LEFT JOIN positions pos ON pos.id = tl.position_id
            WHERE tl.company_id = v_company_id
        ) t
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6) Register a click and return attribution defaults (public / candidate-facing).
CREATE OR REPLACE FUNCTION register_link_click(p_token text)
RETURNS jsonb AS $$
DECLARE v_row tracking_links;
BEGIN
    UPDATE tracking_links
       SET click_count = click_count + 1
     WHERE token = p_token AND is_active = true
    RETURNING * INTO v_row;

    IF v_row.id IS NULL THEN RETURN NULL; END IF;

    RETURN jsonb_build_object(
        'id', v_row.id,
        'position_id', v_row.position_id,
        'source', v_row.source,
        'utm_source', v_row.utm_source,
        'utm_medium', v_row.utm_medium,
        'utm_campaign', v_row.utm_campaign
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7) Source attribution summary: applicants, assessed, hired, avg match per source.
CREATE OR REPLACE FUNCTION get_source_attribution(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RETURN '[]'::jsonb; END IF;

    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(s) ORDER BY s.applicants DESC), '[]'::jsonb)
        FROM (
            SELECT
                COALESCE(NULLIF(c.source, ''), 'direct') AS source,
                count(*) AS applicants,
                count(*) FILTER (
                    WHERE c.status IN ('assessment_completed','interview_scheduled','interviewed','offered','hired')
                ) AS assessed,
                count(*) FILTER (WHERE c.status = 'hired') AS hired,
                round(avg(r.overall_score)) AS avg_match
            FROM candidates c
            LEFT JOIN LATERAL (
                SELECT overall_score FROM assessment_results ar
                WHERE ar.candidate_id = c.id
                ORDER BY completed_at DESC NULLS LAST LIMIT 1
            ) r ON true
            WHERE c.company_id = v_company_id
            GROUP BY COALESCE(NULLIF(c.source, ''), 'direct')
        ) s
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8) Permissions.
GRANT EXECUTE ON FUNCTION create_tracking_link(text, uuid, text, text, text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_tracking_links(text)      TO authenticated, anon;
GRANT EXECUTE ON FUNCTION register_link_click(text)     TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_source_attribution(text)  TO authenticated, anon;
