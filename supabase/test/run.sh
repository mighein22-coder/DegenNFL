#!/usr/bin/env bash
#
# Apply every migration to a throwaway Postgres, in order, and run the security
# tests against the result. Every line of output should read `ok`; a `FAIL` is a
# real hole.
#
# In order matters: the live project already has 0001 applied, so what has to be
# proven safe is the sequence it will actually go through, not a squashed schema
# that no database ever had.
#
# This exists because those guards are the whole security model,
# and a migration whose policies have only ever been *read* is a migration you
# are trusting on vibes. The NHL app found four of these holes in production.
#
#   ./supabase/test/run.sh
#
# Requires a Postgres 16 server reachable with the settings below. Override any
# of them from the environment:
#
#   PGHOST=/tmp PGPORT=5432 PGUSER=postgres ./supabase/test/run.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PGHOST="${PGHOST:-/tmp}"
export PGPORT="${PGPORT:-55432}"
export PGUSER="${PGUSER:-postgres}"
DB="${PGDATABASE_TEST:-degennfl_test}"

echo "==> Recreating $DB"
psql -q -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

echo "==> Supabase fixture (roles, auth.users, auth.uid)"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/00_supabase_fixture.sql"

# Every migration, in order. 0001 creates the schema; later ones amend it, and
# the live project has already had 0001 applied -- so the test must exercise the
# same sequence the real database went through, not a squashed version of it.
for migration in "$HERE"/../migrations/*.sql; do
  echo "==> Applying $(basename "$migration")"
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$migration" >/dev/null
done

echo "==> Security tests"
output=$(psql -v ON_ERROR_STOP=1 -d "$DB" -f "$HERE/01_security.sql" 2>&1)
echo "$output"

if grep -q '^FAIL' <<<"$output"; then
  echo
  echo "FAILED: $(grep -c '^FAIL' <<<"$output") assertion(s) above did not hold."
  exit 1
fi

echo
echo "PASSED: $(grep -c '^ok' <<<"$output") assertions."
