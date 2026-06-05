#!/bin/sh
# Container entrypoint for the ffp services.
#
# The apps read a single DATABASE_URL (see apps/*/src/config.ts), but on AWS the
# Postgres password arrives as an injected ECS secret (DB_PASSWORD) while the
# non-sensitive coordinates arrive as plain env vars (DB_HOST/DB_PORT/DB_NAME/
# DB_USER). Assemble DATABASE_URL from those parts here so the password never
# has to live in the plaintext task definition. If DATABASE_URL is already set
# (local dev, docker-compose), we leave it alone.
#
# The generated DB password excludes punctuation (see DbSecret in stack.ts), so
# it is URL-safe without percent-encoding.
set -e

if [ -z "$DATABASE_URL" ] && [ -n "$DB_HOST" ]; then
  export DATABASE_URL="postgres://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
fi

exec "$@"
