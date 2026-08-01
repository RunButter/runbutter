-- ============================================================================
-- RunButter :: Custom email templates + candidate messaging (additive)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Lets recruiters create reusable, editable email templates (invite, decline,
-- offer, reminder, custom) with {{variables}}, send them to candidates from the
-- dashboard, and keep a message history per candidate.
--
-- This script is self-contained and idempotent: it enables its own extension,
-- drops any stale versions of the RPCs (which otherwise cause PostgREST 400
-- "could not choose the best candidate function" errors), recreates everything,
-- and forces a PostgREST schema-cache reload at the end.
-- ============================================================================

-- uuid_generate_v4() lives in uuid-ossp. The base schema enables it, but we do
-- it here too so this migration works even if run on its own.
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS message_templates (
    id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id uuid REFERENCES companies(id) ON DELETE CASCADE,
    name       text NOT NULL,
    subject    text NOT NULL,
    body       text NOT NULL,
    category   text NOT NULL DEFAULT 'custom',  -- invite | decline | offer | reminder | custom
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_msg_templates_company ON message_templates(company_id);

CREATE TABLE IF NOT EXISTS candidate_messages (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
    candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
    subject      text,
    body         text,
    sent_by      uuid REFERENCES company_users(id) ON DELETE SET NULL,
    created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cand_messages_candidate ON candidate_messages(candidate_id, created_at DESC);

ALTER TABLE message_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE candidate_messages ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['message_templates', 'candidate_messages'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS "company_read_%1$s" ON %1$I;', t);
        EXECUTE format($f$
            CREATE POLICY "company_read_%1$s" ON %1$I FOR SELECT USING (
                company_id IN (
                    SELECT company_id FROM company_users
                    WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
                       OR auth_user_id = auth.uid()
                )
            );
        $f$, t);
    END LOOP;
END$$;

-- Seed sensible defaults for any company that has none yet.
INSERT INTO message_templates (company_id, name, subject, body, category)
SELECT c.id, d.name, d.subject, d.body, d.category
FROM companies c
CROSS JOIN (VALUES
    ('Interview invitation',
     'Interview invitation — {{position}} at {{company}}',
     E'Hi {{first_name}},\n\nThanks for applying for {{position}} at {{company}}. We were impressed and would love to invite you to an interview.\n\nPlease let us know your availability over the next few days and we''ll send a calendar invite.\n\nLooking forward to speaking with you!\n\nBest regards,\nThe {{company}} Hiring Team',
     'invite'),
    ('Polite rejection',
     'Update on your application for {{position}}',
     E'Hi {{first_name}},\n\nThank you for your interest in {{position}} at {{company}} and for the time you invested in applying.\n\nAfter careful consideration, we won''t be moving forward at this stage. This was a competitive process and the decision was not easy. We''d be glad to keep your details on file for future roles that match your skills.\n\nWishing you the very best,\nThe {{company}} Hiring Team',
     'decline'),
    ('Offer',
     'Your offer from {{company}}',
     E'Hi {{first_name}},\n\nWe''re delighted to offer you the {{position}} role at {{company}}! We''ll follow up shortly with the full details.\n\nCongratulations — we''re excited about the prospect of you joining the team.\n\nBest regards,\nThe {{company}} Hiring Team',
     'offer'),
    ('Assessment reminder',
     'Reminder: finish your assessment for {{position}}',
     E'Hi {{first_name}},\n\nJust a friendly nudge to complete your short assessment for {{position}} at {{company}}. It takes about 5 minutes and is the next step in your application.\n\nThanks!\nThe {{company}} Hiring Team',
     'reminder')
) AS d(name, subject, body, category)
WHERE NOT EXISTS (SELECT 1 FROM message_templates m WHERE m.company_id = c.id);

-- RPCs --------------------------------------------------------------------
-- Drop EVERY existing overload of these function names first. CREATE OR REPLACE
-- only replaces a function with an identical signature; if an older version with
-- different argument types exists, you end up with two overloads and PostgREST
-- returns HTTP 400 ("could not choose the best candidate function"). This wipes
-- the slate so the definitions below are the only ones that exist.
DO $$
DECLARE r record;
BEGIN
    FOR r IN
        SELECT 'DROP FUNCTION IF EXISTS ' || oid::regprocedure || ' CASCADE;' AS stmt
        FROM pg_proc
        WHERE pronamespace = 'public'::regnamespace
          AND proname IN ('get_message_templates', 'upsert_message_template',
                          'delete_message_template', 'log_candidate_message')
    LOOP
        EXECUTE r.stmt;
    END LOOP;
END$$;

CREATE OR REPLACE FUNCTION get_message_templates(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RETURN '[]'::jsonb; END IF;
    -- Order by created_at directly off the table; building the JSON object
    -- explicitly keeps the payload to the 5 fields the UI needs. (The previous
    -- version ordered by t.created_at on a subquery that didn't select it,
    -- which raised "column t.created_at does not exist" for any real company.)
    RETURN (
        SELECT COALESCE(jsonb_agg(
            jsonb_build_object(
                'id', t.id, 'name', t.name, 'subject', t.subject,
                'body', t.body, 'category', t.category
            ) ORDER BY t.created_at
        ), '[]'::jsonb)
        FROM message_templates t
        WHERE t.company_id = v_company_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION upsert_message_template(
    p_privy_user_id text, p_id uuid, p_name text, p_subject text, p_body text, p_category text
)
RETURNS jsonb AS $$
DECLARE v_company_id uuid; v_row message_templates;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;

    IF p_id IS NULL THEN
        INSERT INTO message_templates (company_id, name, subject, body, category)
        VALUES (v_company_id, p_name, p_subject, p_body, COALESCE(NULLIF(p_category,''),'custom'))
        RETURNING * INTO v_row;
    ELSE
        UPDATE message_templates
        SET name = p_name, subject = p_subject, body = p_body,
            category = COALESCE(NULLIF(p_category,''),'custom'), updated_at = now()
        WHERE id = p_id AND company_id = v_company_id
        RETURNING * INTO v_row;
        IF v_row.id IS NULL THEN RAISE EXCEPTION 'TEMPLATE_NOT_FOUND'; END IF;
    END IF;
    RETURN row_to_json(v_row);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION delete_message_template(p_privy_user_id text, p_id uuid)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;
    DELETE FROM message_templates WHERE id = p_id AND company_id = v_company_id;
    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Records a sent message in history (called by the send route after delivery).
CREATE OR REPLACE FUNCTION log_candidate_message(
    p_privy_user_id text, p_candidate_id uuid, p_subject text, p_body text
)
RETURNS jsonb AS $$
DECLARE v_company_id uuid; v_user_id uuid; v_cand_company uuid;
BEGIN
    SELECT id, company_id INTO v_user_id, v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;
    SELECT company_id INTO v_cand_company FROM candidates WHERE id = p_candidate_id;
    IF v_cand_company IS NULL OR v_cand_company <> v_company_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    INSERT INTO candidate_messages (company_id, candidate_id, subject, body, sent_by)
    VALUES (v_company_id, p_candidate_id, p_subject, p_body, v_user_id);
    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_message_templates(text)                                   TO authenticated, anon;
GRANT EXECUTE ON FUNCTION upsert_message_template(text, uuid, text, text, text, text)   TO authenticated, anon;
GRANT EXECUTE ON FUNCTION delete_message_template(text, uuid)                           TO authenticated, anon;
GRANT EXECUTE ON FUNCTION log_candidate_message(text, uuid, text, text)                 TO authenticated, anon;

-- Force PostgREST to reload its schema cache so the new RPCs are callable
-- immediately (a freshly created function can otherwise 404/400 until reload).
NOTIFY pgrst, 'reload schema';
