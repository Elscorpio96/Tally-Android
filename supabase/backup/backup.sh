#!/bin/sh
# Full backup of the shop data (tables, functions, policies) from your Supabase project.
# Needs: pg_dump 15+ on PATH, and SUPABASE_DB_URL = the *Session pooler* connection string
#        (Supabase dashboard -> Connect -> Session pooler). Keep it secret; never commit it.
# Usage: SUPABASE_DB_URL='postgresql://...' ./backup.sh [output-folder]
set -eu
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL to the session-pooler connection string}"
out="${1:-.}"; mkdir -p "$out"
file="$out/ilelah-$(date -u +%Y%m%d-%H%M%S).dump"
pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges -n public -n app -f "$file"
# logins (e-mail + password hashes) live in the auth schema; keep them too so people can sign in after a restore into a new project
pg_dump "$SUPABASE_DB_URL" -Fc --no-owner --no-privileges --data-only -t auth.users -t auth.identities -f "${file%.dump}.auth.dump"
# a backup you cannot read back is not a backup: list its contents as a check
pg_restore -l "$file" > /dev/null && pg_restore -l "${file%.dump}.auth.dump" > /dev/null
size=$(wc -c < "$file")
[ "$size" -gt 5000 ] || { echo "Backup looks empty ($size bytes)" >&2; exit 1; }
echo "$file ($size bytes)"
