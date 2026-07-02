-- ============================================================================
-- HireBTR Platform Core — 0023_ksef_auth.sql
-- Per-tenant KSeF credentials + session cache. One row per workspace: the NIP
-- and the KSeF token stored as AES-256-GCM ciphertext (cipher + iv + auth tag,
-- all base64). The AES master key lives ONLY in the app env (KSEF_MASTER_KEY),
-- never in the DB. This table is accessed exclusively via the service-role
-- backend module (lib/ksef/service.ts) — RLS is enabled with no policies so it
-- is unreadable through the anon/authenticated keys.
-- Additive & prod-safe. Depends on 0001–0022. Run AFTER them.
-- ============================================================================

create table if not exists ksef_configs (
  workspace_id            uuid primary key references workspaces(id) on delete cascade,
  nip                     text not null,
  token_cipher            text not null,          -- base64 AES-256-GCM ciphertext
  token_iv                text not null,          -- base64 96-bit IV (unique per encryption)
  token_tag               text not null,          -- base64 GCM auth tag
  environment             text not null default 'test',   -- test | prod
  access_token            text,                   -- cached KSeF JWT (short-lived)
  access_token_expires_at timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists trg_ksef_configs_upd on ksef_configs;
create trigger trg_ksef_configs_upd before update on ksef_configs for each row execute function set_updated_at();

-- RLS on, NO policies: only the service_role key (backend) may touch it.
alter table ksef_configs enable row level security;

notify pgrst, 'reload schema';
