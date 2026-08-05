#!/usr/bin/env bash
# RunButter — local setup.
#
# Does the boring parts of a first run: checks Node, installs dependencies,
# creates .env.local, and applies the schema if you give it a database. It
# stops and tells you what to do whenever a decision is yours.
#
#   ./setup.sh
#
# Prefer containers? `docker compose up` needs none of this — see docs/install.md.

set -euo pipefail

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
info() { printf '\033[2m•\033[0m %s\n' "$1"; }
warn() { printf '\033[33m!\033[0m %s\n' "$1"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$1"; exit 1; }

echo
echo "RunButter — setup"
echo "─────────────────"
echo

# ── 1. Node ─────────────────────────────────────────────────────────────────
command -v node >/dev/null 2>&1 || die "Node.js is not installed. Get 18 or newer from https://nodejs.org"
NODE_MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
[ "$NODE_MAJOR" -ge 18 ] || die "Node 18+ required (found $(node -v))."
ok "Node $(node -v)"

# ── 2. Dependencies ─────────────────────────────────────────────────────────
# `npm ci` when there is a lockfile: it reproduces exactly what was tested,
# and it is what CI and the Docker image use.
if [ -f package-lock.json ]; then
  info "Installing dependencies (npm ci)…"
  npm ci
else
  info "Installing dependencies (npm install)…"
  npm install
fi
ok "Dependencies installed"

# ── 3. Environment ──────────────────────────────────────────────────────────
if [ -f .env.local ]; then
  ok ".env.local already exists — leaving it alone"
else
  cp .env.example .env.local
  ok "Created .env.local from .env.example"
fi

MISSING=()
for VAR in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY SUPABASE_SERVICE_ROLE_KEY NEXT_PUBLIC_PRIVY_APP_ID; do
  # Present but empty counts as missing; that is the state cp leaves them in.
  if ! grep -qE "^${VAR}=.+" .env.local 2>/dev/null; then MISSING+=("$VAR"); fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo
  warn "Still needed in .env.local:"
  for VAR in "${MISSING[@]}"; do echo "    $VAR"; done
  echo
  echo "    Supabase keys:  your project → Settings → API"
  echo "    Privy app id:   https://dashboard.privy.io (free, 2 minutes)"
  echo
  echo "    Nothing loads without the first three, and login does not work"
  echo "    without the fourth. Everything else in the file is optional."
fi

# ── 4. Schema ───────────────────────────────────────────────────────────────
echo
if [ -n "${DATABASE_URL:-}" ]; then
  info "DATABASE_URL is set — applying the schema…"
  npm run migrate
else
  info "Skipping the database: DATABASE_URL is not set."
  echo
  echo "    When you have a Postgres, apply the schema with:"
  echo
  echo "      DATABASE_URL='postgresql://…:5432/postgres' npm run migrate"
  echo
  echo "    Supabase: Settings → Database → Connection string → Session pooler."
  echo "    Port 5432 (session), NOT 6543 (transaction) — migrations need"
  echo "    session state and fail on the transaction pooler in confusing ways."
  echo
  echo "    No terminal for that? Paste supabase/schema.sql into the SQL editor."
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo
ok "Setup finished"
echo
echo "    npm run dev      → http://localhost:3000"
echo "    docs/install.md  → the long version, including Docker"
echo
