#!/bin/sh
# Restores a backup made by backup.sh into a NEW, empty Supabase project (or a scratch database for a practice run).
# Create the new project first, but do NOT run the migrations on it: the backup already contains the tables, functions
# and security rules. Logins live in Supabase Auth, which is not in this backup (see DEPLOYMENT.md, "Restore").
# Usage: TARGET_DB_URL='postgresql://...' ./restore.sh ilelah-YYYYMMDD-HHMMSS.dump
set -eu
: "${TARGET_DB_URL:?Set TARGET_DB_URL to the NEW project's connection string}"
dump="${1:?Give the .dump file}"
tmp=$(mktemp); trap 'rm -f "$tmp"' EXIT
# logins first (so the shop's people still exist), then the shop data
authdump="${dump%.dump}.auth.dump"
if [ -f "$authdump" ]; then pg_restore -d "$TARGET_DB_URL" --no-owner --no-privileges --data-only --exit-on-error "$authdump"; else echo "No $authdump found: people will have to be invited again." >&2; fi
# the new project already has a "public" schema, so skip creating it
pg_restore -l "$dump" | grep -v ' SCHEMA - public ' > "$tmp"
pg_restore -d "$TARGET_DB_URL" --no-owner --no-privileges --exit-on-error -L "$tmp" "$dump"
echo "Restored. Now check: select cloud_totals(); as the owner, and compare with the totals you saved."
