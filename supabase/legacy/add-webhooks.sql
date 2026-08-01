-- ============================================================================
-- RunButter :: Outgoing webhooks / integrations (additive, BYO-URL)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Each company can register its own webhook URLs (Slack / Discord incoming
-- webhooks, or a generic JSON endpoint for Zapier / Make / n8n). RunButter POSTs
-- to them on key events — no platform API keys, no cost on our side. The end
-- user pastes a URL they own; we just deliver JSON to it.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS webhook_endpoints (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    label      text NOT NULL DEFAULT '',
    type       text NOT NULL DEFAULT 'generic',  -- slack | discord | generic
    url        text NOT NULL,
    events     text[] NOT NULL DEFAULT ARRAY['application.created','candidate.stage_changed','candidate.hired'],
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_company ON webhook_endpoints(company_id);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "company_read_webhook_endpoints" ON webhook_endpoints;
CREATE POLICY "company_read_webhook_endpoints" ON webhook_endpoints FOR SELECT USING (
    company_id IN (
        SELECT company_id FROM company_users
        WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
           OR auth_user_id = auth.uid()
    )
);

-- RPCs --------------------------------------------------------------------
-- Drop every existing overload first so re-runs can't create ambiguous
-- functions (PostgREST 400 "could not choose the best candidate function").
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT 'DROP FUNCTION IF EXISTS ' || oid::regprocedure || ' CASCADE;' AS stmt
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('get_webhook_endpoints', 'upsert_webhook_endpoint', 'delete_webhook_endpoint')
    LOOP
        EXECUTE r.stmt;
    END LOOP;
END$$;

CREATE OR REPLACE FUNCTION get_webhook_endpoints(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RETURN '[]'::jsonb; END IF;
    RETURN (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', t.id, 'label', t.label, 'type', t.type,
                'url', t.url, 'events', t.events, 'is_active', t.is_active
            ) ORDER BY t.created_at
        ), '[]'::jsonb)
        FROM webhook_endpoints t
        WHERE t.company_id = v_company_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION upsert_webhook_endpoint(
    p_privy_user_id text, p_id uuid, p_label text, p_type text, p_url text,
    p_events text[], p_is_active boolean
)
RETURNS jsonb AS $$
DECLARE v_company_id uuid; v_row webhook_endpoints;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;
    IF p_url IS NULL OR p_url = '' THEN RAISE EXCEPTION 'URL_REQUIRED'; END IF;

    IF p_id IS NULL THEN
        INSERT INTO webhook_endpoints (company_id, label, type, url, events, is_active)
        VALUES (
            v_company_id, COALESCE(p_label, ''), COALESCE(NULLIF(p_type, ''), 'generic'), p_url,
            COALESCE(p_events, ARRAY['application.created','candidate.stage_changed','candidate.hired']),
            COALESCE(p_is_active, true)
        )
        RETURNING * INTO v_row;
    ELSE
        UPDATE webhook_endpoints
        SET label = COALESCE(p_label, ''),
            type = COALESCE(NULLIF(p_type, ''), 'generic'),
            url = p_url,
            events = COALESCE(p_events, events),
            is_active = COALESCE(p_is_active, is_active)
        WHERE id = p_id AND company_id = v_company_id
        RETURNING * INTO v_row;
        IF v_row.id IS NULL THEN RAISE EXCEPTION 'ENDPOINT_NOT_FOUND'; END IF;
    END IF;
    RETURN row_to_json(v_row);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_webhook_endpoint(p_privy_user_id text, p_id uuid)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;
    DELETE FROM webhook_endpoints WHERE id = p_id AND company_id = v_company_id;
    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_webhook_endpoints(text)                                            TO authenticated, anon;
GRANT EXECUTE ON FUNCTION upsert_webhook_endpoint(text, uuid, text, text, text, text[], boolean) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION delete_webhook_endpoint(text, uuid)                                    TO authenticated, anon;

NOTIFY pgrst, 'reload schema';
