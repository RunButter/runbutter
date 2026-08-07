# The migration runner, on its own.
#
# A separate image from the app because it needs the SQL files and the pg
# driver and nothing else — no Next build, no bundle. It is a one-shot service
# the rest of the stack waits on, so keeping it small is the difference between
# `docker compose up` starting in seconds and starting after a full app build.

FROM node:22-slim
WORKDIR /app

# Only the driver. `npm ci` here would install the whole project to run one
# script against fifteen kilobytes of JavaScript.
RUN npm install --no-save pg@8

# scripts/lib TOO, and that omission is the whole reason `docker compose up`
# never worked for anyone. migrate.mjs imports LEGACY_ORDER from
# ./lib/legacy-order.mjs; copying only the entrypoint gave the container a
# script whose very first import fails, so the migrate service exited 1, the
# services that wait on it never started, and the stack died before the app was
# ever reached. It was invisible locally because `npm run migrate` runs in the
# full repository, where that file is simply there.
#
# Copy the DIRECTORY the script actually needs, not the one file it is named
# after. scripts/check-docker-copy.mjs now fails CI if an import escapes it.
COPY scripts/migrate.mjs ./scripts/migrate.mjs
COPY scripts/lib ./scripts/lib
COPY supabase ./supabase

CMD ["node", "scripts/migrate.mjs"]
