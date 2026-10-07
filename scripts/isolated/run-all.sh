#!/bin/bash
# The old every-proof runner is gone: it cloned `post`, re-applied migrations that `post` already holds, used a stale
# `cand` scheme and could not run. The maintained runner is scripts/gate/run.ts and the tiers are registries:
#
#   npm run verify:critical     the security and reliability critical proofs (about 3 minutes, in parallel)
#   npm run verify:extended     the forensic and audit proofs
#   npm run verify:proofs       both
#   npm run check:proofs        registry integrity only (every proof registered exactly once)
#
# See docs/testing/CRITICAL-GATE.md. This file stays so `bash scripts/isolated/run-all.sh` still does the right thing.
ROOT=$(cd "$(dirname "$0")/../.." && pwd); cd "$ROOT"
exec node_modules/.bin/tsx scripts/gate/run.ts --tier all "$@"
