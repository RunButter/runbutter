#!/usr/bin/env bash
# Mirror main to the public open-source repo.
#
#   npm run publish:oss
#
# WHY THIS EXISTS. There are two GitHub repos and only one of them is the one
# you work in:
#
#   CasperCrypto/hirebtr    the working repo. Render deploys from it. Every
#                           commit lands here first.
#   RunButter/runbutter     the public, open-source repo. Same code, published.
#
# They are NOT two projects and there is no second set of commits to write. The
# public repo is a copy of `main`, pushed when you want the world to see what
# you have. Doing that by hand means remembering a URL and a branch at the exact
# moment you are least likely to — hence this.
#
# It refuses to push anything that is not a fast-forward. A force-push to a
# public repo rewrites history under anyone who has cloned or forked it, and
# "my working copy is now unpushable" is a bad first impression of a project
# somebody just starred.

set -euo pipefail

PUBLIC_URL="https://github.com/RunButter/runbutter.git"
BRANCH="main"

ok()   { printf '\033[32m✓\033[0m %s\n' "$1"; }
info() { printf '\033[2m•\033[0m %s\n' "$1"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$1"; exit 1; }

# ── The tree has to be clean ────────────────────────────────────────────────
# Publishing from a dirty tree publishes the last commit, not what you are
# looking at, which is the kind of surprise you find out about from an issue.
[ -z "$(git status --porcelain)" ] || die "You have uncommitted changes. Commit them first — publishing pushes commits, not your working tree."

# ── …and it has to be main ──────────────────────────────────────────────────
CURRENT=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT" != "$BRANCH" ]; then
  die "You are on '$CURRENT'. Merge into $BRANCH first — the public repo tracks $BRANCH."
fi

# ── The remote, created on first use ────────────────────────────────────────
if git remote get-url public >/dev/null 2>&1; then
  info "remote 'public' → $(git remote get-url public)"
else
  git remote add public "$PUBLIC_URL"
  ok "Added remote 'public' → $PUBLIC_URL"
fi

# ── Push the working repo first ─────────────────────────────────────────────
# The public copy must never be AHEAD of the one Render builds; that is how you
# end up serving something older than what people are reading.
info "Pushing to origin (the repo Render deploys)…"
git push origin "$BRANCH"
ok "origin/$BRANCH up to date"

info "Publishing to RunButter/runbutter…"
if git push public "$BRANCH"; then
  ok "Published — https://github.com/RunButter/runbutter"
else
  echo
  die "Push rejected. The public repo has commits yours does not (edited a file on
    github.com? merged a PR there?). Bring them in rather than overwriting:

      git fetch public $BRANCH
      git merge public/$BRANCH
      npm run publish:oss

    Only force if you are certain nobody has that history:
      git push public $BRANCH --force"
fi
