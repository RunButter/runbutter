-- ============================================================================
-- RunButter :: Module 4 — "My Team" post-hire workspace (additive, non-breaking)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- "My Team" = candidates with status = 'hired'. No separate employees table —
-- we read the hired candidate + their latest assessment scores directly.
-- Adds: weekly pulse check-ins, 2-strike retention alerts, persisted
-- onboarding checklist tasks, and the RPCs the workspace needs.
-- ============================================================================

-- 1) Weekly pulse check-ins.
CREATE TABLE IF NOT EXISTS pulse_checkins (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
    candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
    week_start   date NOT NULL,
    mood         text NOT NULL CHECK (mood IN ('happy', 'balanced', 'overwhelmed')),
    note         text,
    created_at   timestamptz DEFAULT now(),
    UNIQUE (candidate_id, week_start)
);
CREATE INDEX IF NOT EXISTS idx_pulse_candidate ON pulse_checkins(candidate_id, week_start DESC);

-- 2) Retention alerts (fired by the streak trigger below).
CREATE TABLE IF NOT EXISTS retention_alerts (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
    candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
    reason       text NOT NULL,
    is_resolved  boolean NOT NULL DEFAULT false,
    created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_open ON retention_alerts(company_id) WHERE NOT is_resolved;

-- 3) Persisted onboarding checklist tasks (items themselves are generated
--    client-side from traits; we only store completion state by task_key).
CREATE TABLE IF NOT EXISTS onboarding_tasks (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id   uuid REFERENCES companies(id) ON DELETE CASCADE,
    candidate_id uuid REFERENCES candidates(id) ON DELETE CASCADE,
    task_key     text NOT NULL,
    title        text NOT NULL,
    is_done      boolean NOT NULL DEFAULT false,
    created_at   timestamptz DEFAULT now(),
    UNIQUE (candidate_id, task_key)
);
CREATE INDEX IF NOT EXISTS idx_onb_tasks_candidate ON onboarding_tasks(candidate_id);

-- 4) Fire a high-priority retention alert on two consecutive 'overwhelmed' weeks.
CREATE OR REPLACE FUNCTION check_pulse_streak()
RETURNS trigger AS $$
DECLARE prev_mood text;
BEGIN
    IF NEW.mood = 'overwhelmed' THEN
        SELECT mood INTO prev_mood FROM pulse_checkins
        WHERE candidate_id = NEW.candidate_id AND week_start = (NEW.week_start - 7)
        ORDER BY week_start DESC LIMIT 1;

        IF prev_mood = 'overwhelmed' THEN
            INSERT INTO retention_alerts (company_id, candidate_id, reason)
            VALUES (NEW.company_id, NEW.candidate_id, 'overwhelmed_2wk');
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_pulse_streak ON pulse_checkins;
CREATE TRIGGER trg_pulse_streak AFTER INSERT ON pulse_checkins
    FOR EACH ROW EXECUTE FUNCTION check_pulse_streak();

-- 5) RLS (writes via SECURITY DEFINER RPCs; these guard direct reads).
ALTER TABLE pulse_checkins   ENABLE ROW LEVEL SECURITY;
ALTER TABLE retention_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tasks ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY['pulse_checkins', 'retention_alerts', 'onboarding_tasks'] LOOP
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

-- 6) RPCs.
CREATE OR REPLACE FUNCTION get_my_team(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RETURN '[]'::jsonb; END IF;

    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
        FROM (
            SELECT
                can.id, can.full_name, can.email, can.position_id, can.updated_at,
                pos.title AS position_title, pos.neuro_profile AS position_neuro_profile,
                res.overall_score, res.personality_score, res.work_style_score, res.cognitive_score,
                res.personality_data, res.work_style_data,
                (SELECT mood FROM pulse_checkins p WHERE p.candidate_id = can.id ORDER BY week_start DESC LIMIT 1) AS latest_mood,
                EXISTS (SELECT 1 FROM retention_alerts a WHERE a.candidate_id = can.id AND NOT a.is_resolved) AS has_alert,
                (SELECT count(*) FROM onboarding_tasks o WHERE o.candidate_id = can.id) AS task_total,
                (SELECT count(*) FROM onboarding_tasks o WHERE o.candidate_id = can.id AND o.is_done) AS task_done
            FROM candidates can
            LEFT JOIN positions pos ON pos.id = can.position_id
            LEFT JOIN LATERAL (
                SELECT * FROM assessment_results r WHERE r.candidate_id = can.id
                ORDER BY completed_at DESC NULLS LAST LIMIT 1
            ) res ON true
            WHERE can.company_id = v_company_id AND can.status = 'hired'
            ORDER BY can.updated_at DESC
        ) t
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION record_pulse(
    p_privy_user_id text, p_candidate_id uuid, p_week_start date, p_mood text, p_note text
)
RETURNS jsonb AS $$
DECLARE v_company_id uuid; v_cand_company uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;
    SELECT company_id INTO v_cand_company FROM candidates WHERE id = p_candidate_id;
    IF v_cand_company IS NULL OR v_cand_company <> v_company_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    INSERT INTO pulse_checkins (company_id, candidate_id, week_start, mood, note)
    VALUES (v_company_id, p_candidate_id, p_week_start, p_mood, NULLIF(p_note, ''))
    ON CONFLICT (candidate_id, week_start) DO UPDATE SET mood = EXCLUDED.mood, note = EXCLUDED.note;

    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_onboarding_tasks(p_privy_user_id text, p_candidate_id uuid)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RETURN '[]'::jsonb; END IF;
    RETURN (
        SELECT COALESCE(jsonb_agg(row_to_json(o)), '[]'::jsonb)
        FROM (
            SELECT task_key, title, is_done FROM onboarding_tasks
            WHERE candidate_id = p_candidate_id AND company_id = v_company_id
        ) o
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION set_onboarding_task(
    p_privy_user_id text, p_candidate_id uuid, p_task_key text, p_title text, p_is_done boolean
)
RETURNS jsonb AS $$
DECLARE v_company_id uuid; v_cand_company uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;
    SELECT company_id INTO v_cand_company FROM candidates WHERE id = p_candidate_id;
    IF v_cand_company IS NULL OR v_cand_company <> v_company_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;

    INSERT INTO onboarding_tasks (company_id, candidate_id, task_key, title, is_done)
    VALUES (v_company_id, p_candidate_id, p_task_key, p_title, p_is_done)
    ON CONFLICT (candidate_id, task_key) DO UPDATE SET is_done = EXCLUDED.is_done, title = EXCLUDED.title;

    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION get_my_team(text)                              TO authenticated, anon;
GRANT EXECUTE ON FUNCTION record_pulse(text, uuid, date, text, text)     TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_onboarding_tasks(text, uuid)               TO authenticated, anon;
GRANT EXECUTE ON FUNCTION set_onboarding_task(text, uuid, text, text, boolean) TO authenticated, anon;
