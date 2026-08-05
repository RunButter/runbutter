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

COPY scripts/migrate.mjs ./scripts/
COPY supabase ./supabase

CMD ["node", "scripts/migrate.mjs"]
