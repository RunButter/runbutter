-- ============================================================================
-- HireBTR :: Module 5 — RODO / GDPR compliance (additive, non-breaking)
-- Run in the Supabase SQL Editor. Safe to re-run.
--
-- Adds: per-applicant consent fields + an immutable consent ledger, a
-- configurable retention window per company, and an anonymization routine
-- (scheduled via pg_cron when available) that scrubs PII + raw resume text
-- from candidates older than the retention window.
-- ============================================================================

-- 1) Retention window per company (days).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS retention_days integer NOT NULL DEFAULT 180;

-- 2) Consent snapshot on the applicant row.
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_given          boolean NOT NULL DEFAULT false;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_at             timestamptz;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_ip             inet;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS consent_policy_version text;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS anonymized_at          timestamptz;

-- 3) Immutable consent ledger (audit trail beyond the candidate snapshot).
CREATE TABLE IF NOT EXISTS consent_logs (
    id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_id     uuid REFERENCES companies(id) ON DELETE CASCADE,
    candidate_id   uuid REFERENCES candidates(id) ON DELETE SET NULL,
    action         text NOT NULL CHECK (action IN ('granted', 'withdrawn', 'updated')),
    policy_version text,
    ip_address     inet,
    user_agent     text,
    created_at     timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_consent_candidate ON consent_logs(candidate_id);

ALTER TABLE consent_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "company_read_consent" ON consent_logs;
CREATE POLICY "company_read_consent" ON consent_logs FOR SELECT USING (
    company_id IN (
        SELECT company_id FROM company_users
        WHERE privy_user_id = current_setting('app.current_privy_user_id', true)
           OR auth_user_id = auth.uid()
    )
);

-- 4) Log a consent action (called from the public apply flow -> anon allowed).
CREATE OR REPLACE FUNCTION log_consent(
    p_candidate_id   uuid,
    p_action         text,
    p_policy_version text,
    p_ip             text,
    p_user_agent     text
)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM candidates WHERE id = p_candidate_id;
    IF v_company_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason', 'no_candidate'); END IF;

    INSERT INTO consent_logs (company_id, candidate_id, action, policy_version, ip_address, user_agent)
    VALUES (v_company_id, p_candidate_id, p_action, NULLIF(p_policy_version, ''),
            NULLIF(p_ip, '')::inet, NULLIF(p_user_agent, ''));

    IF p_action = 'granted' THEN
        UPDATE candidates
        SET consent_given = true,
            consent_at = now(),
            consent_ip = NULLIF(p_ip, '')::inet,
            consent_policy_version = NULLIF(p_policy_version, '')
        WHERE id = p_candidate_id;
    ELSIF p_action = 'withdrawn' THEN
        UPDATE candidates SET consent_given = false WHERE id = p_candidate_id;
    END IF;

    RETURN jsonb_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5) Anonymize candidates past their company's retention window.
--    Scrubs PII + raw resume text; KEEPS non-PII analytics (scores, source,
--    timestamps). Skips hired candidates and already-anonymized rows.
--    `email` is NOT NULL/unique, so we redact to a stable placeholder.
CREATE OR REPLACE FUNCTION anonymize_expired_candidates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE affected integer;
BEGIN
    UPDATE candidates c
    SET resume_raw_text = NULL,
        cv_url          = NULL,
        full_name       = 'Anonymized Candidate',
        email           = 'redacted-' || c.id || '@anonymized.invalid',
        phone           = NULL,
        linkedin_url    = NULL,
        consent_ip      = NULL,
        anonymized_at   = now()
    FROM companies o
    WHERE c.company_id = o.id
      AND c.anonymized_at IS NULL
      AND c.status <> 'hired'
      AND c.applied_at < now() - make_interval(days => o.retention_days);
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN affected;
END;
$$;

-- 6) Manual, company-scoped anonymization trigger for recruiters/admins.
CREATE OR REPLACE FUNCTION run_anonymization(p_privy_user_id text)
RETURNS jsonb AS $$
DECLARE v_company_id uuid; v_retention integer; affected integer;
BEGIN
    SELECT cu.company_id, co.retention_days INTO v_company_id, v_retention
    FROM company_users cu JOIN companies co ON co.id = cu.company_id
    WHERE cu.privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;

    UPDATE candidates c
    SET resume_raw_text = NULL, cv_url = NULL, full_name = 'Anonymized Candidate',
        email = 'redacted-' || c.id || '@anonymized.invalid',
        phone = NULL, linkedin_url = NULL, consent_ip = NULL, anonymized_at = now()
    WHERE c.company_id = v_company_id
      AND c.anonymized_at IS NULL
      AND c.status <> 'hired'
      AND c.applied_at < now() - make_interval(days => v_retention);
    GET DIAGNOSTICS affected = ROW_COUNT;
    RETURN jsonb_build_object('ok', true, 'anonymized', affected);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7) Update a company's retention window (admin).
CREATE OR REPLACE FUNCTION set_retention_days(p_privy_user_id text, p_days integer)
RETURNS jsonb AS $$
DECLARE v_company_id uuid;
BEGIN
    SELECT company_id INTO v_company_id FROM company_users WHERE privy_user_id = p_privy_user_id LIMIT 1;
    IF v_company_id IS NULL THEN RAISE EXCEPTION 'RECRUITER_NOT_FOUND'; END IF;
    IF p_days < 30 OR p_days > 3650 THEN RAISE EXCEPTION 'RETENTION_OUT_OF_RANGE'; END IF;
    UPDATE companies SET retention_days = p_days WHERE id = v_company_id;
    RETURN jsonb_build_object('ok', true, 'retention_days', p_days);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION log_consent(uuid, text, text, text, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION run_anonymization(text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION set_retention_days(text, integer)         TO authenticated;

-- 8) Schedule daily anonymization at 03:30 if pg_cron is enabled (no-op otherwise).
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        PERFORM cron.schedule('hirebtr-anonymize-daily', '30 3 * * *',
            $cron$ SELECT anonymize_expired_candidates(); $cron$);
    END IF;
END$$;
