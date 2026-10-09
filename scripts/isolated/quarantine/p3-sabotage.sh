#!/bin/bash
# QUARANTINED (see ./README.md): never run. It REWRITES A MIGRATION FILE IN THE WORKING TREE, which races every other
# editor of a shared tree. Use scripts/gate/sabotage.ts, which breaks a CLONE DATABASE instead.
#
# Prove a case set can fail: apply a copy of a migration with ONE edit, run the attack cases, expect RED, restore.
#   scripts/isolated/p3-sabotage.sh <migration-file-name> <old-text> <new-text> [cases-fragment]
# The edit is asserted to land (printed), and the migration file is always restored.
set -uo pipefail
cd "$(dirname "$0")/../../.."
F=migrations/$1; OLD=$2; NEW=$3; ONLY=${4:-}
cp "$F" /tmp/sabotage.orig
trap 'cp /tmp/sabotage.orig "$F"' EXIT
python3 - "$F" "$OLD" "$NEW" <<'PY'
import sys
p,old,new=sys.argv[1:4]
s=open(p).read()
assert s.count(old)>=1, f'SABOTAGE ANCHOR MISSING: {old[:60]}'
open(p,'w').write(s.replace(old,new,1)); print('sabotage landed: True')
PY
[ $? -eq 0 ] || exit 3
scripts/isolated/p3-attack.sh p3_attack_sab >/dev/null 2>&1
npx tsx scripts/isolated/p3-app-attack.ts p3_attack_sab $ONLY 2>&1 | grep -E "^FAIL|checks passed"
