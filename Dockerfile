# RunButter — production image.
#
# Multi-stage so the shipped layer has no build toolchain in it. Next's
# standalone output is what makes the final image small: it traces exactly the
# node_modules the server actually reaches and copies only those, instead of the
# ~700 MB of dependencies this project installs to build.

# ── deps ────────────────────────────────────────────────────────────────────
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Chromium is a build-time dependency of nothing here — Playwright is only used
# for local verification — so stop its postinstall from pulling ~300 MB.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci

# ── build ───────────────────────────────────────────────────────────────────
FROM node:22-slim AS build
WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# The build PRERENDERS pages, and a page that reads a missing env var throws at
# module scope and fails the whole build. These are placeholders for that pass
# only — the real values arrive at runtime from the environment. A wrong Privy
# app id here would break login at runtime, which is why it is not a fallback
# anywhere in the app itself.
ARG NEXT_PUBLIC_SUPABASE_URL=http://localhost:8000
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=build-placeholder
ARG NEXT_PUBLIC_PRIVY_APP_ID=clpispdty00ycl80fpueukbhl
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID \
    SUPABASE_SERVICE_ROLE_KEY=build-placeholder \
    STRIPE_SECRET_KEY=sk_test_build_placeholder \
    NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ── run ─────────────────────────────────────────────────────────────────────
FROM node:22-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0

# Never root. A container that mounts nothing still runs code from the network.
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
