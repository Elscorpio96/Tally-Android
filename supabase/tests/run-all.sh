#!/bin/sh
# Runs every database/logic test. Needs: npm i @electric-sql/pglite (see SETUP.md). node 22+.
cd "$(dirname "$0")" || exit 1
fail=0
for f in lines discounts returns rls_and_functions import roundtrip outbox create_staff dashboard_calc cloudmode switch; do
  out=$(node --experimental-strip-types $f.test.mjs 2>&1); rc=$?
  printf '%-22s%s\n' "$f" "$(echo "$out" | grep -E 'passed|FAIL' | tr '\n' ' ')"
  [ $rc -ne 0 ] && fail=1
done
# real-PostgreSQL concurrency + backup/restore drill (only if a server is available: PGHOST/PGPORT/PGUSER set, plus `npm i pg`)
if [ -n "$PGPORT" ]; then
  out=$(node realpg.test.mjs 2>&1); rc=$?
  printf '%-22s%s\n' "realpg" "$(echo "$out" | grep -E 'passed|FAIL' | tr '\n' ' ')"
  [ $rc -ne 0 ] && fail=1
fi
exit $fail
