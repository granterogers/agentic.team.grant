# ADR-0067 — What ships must be attributable to a pushed commit, and a credential is active only when the database proves it

**Status:** accepted by Grant on 6 October 2026 (the three rulings below were his) · BUILT and proved on the isolated replica and in a local
browser; **nothing deployed, nothing applied to production** · **Date:** 6 October 2026

## Context

The public Sample Office reached production on 5 October from a working tree that was never committed. Migrations `0897` and `0898` were applied
through the Management API; the database ledger recorded their names and checksums and the repository held neither file, so `npm run migrate`
was blocked for every future change (`checksum/missing`) until the work was recovered. `0898` came back byte for byte from the statement history; `0897`
could not be rebuilt and had to come from the session that wrote it. The edge functions and the page were live from the same tree.

The migration runner already refuses the history side of that (an applied migration with no file, a checksum that disagrees, a duplicate number). Nothing
refused the SOURCE side: a deploy or migration run from a tree no commit describes.

Reconciling the two streams then found a second thing the same week had not seen: migration 1000, still unapplied, backfilled every office that holds a
Google secret as an `active` connection. A secret in the vault proves a token was stored, not that Google still honours it, and one of the real tokens had
been revoked on 15 September.

## Decision

1. **A deploy or a migration run ships only a pushed, committed source.** `src/safety/require-production-writes.ts` (the first import of every deploy and
   migrate script) asks `src/safety/provenance.ts` once, from the command being run, so a deploy script written later is covered without anybody remembering:
   refused when this is not a git checkout, when the tree is dirty where it ships (untracked files count; `docs/`, `tests/`, `.out/` do not ship), or when HEAD
   is on no remote-tracking branch. A `--dry` migrate list, which changes nothing, is not asked.
2. **The one bypass is a sentence.** `ALLOW_UNPROVENANCED_DEPLOY="<a reason of at least 20 characters>"`. It waives only the three source checks, never the
   migration-history checks (which have no switch), and is printed in full and appended to `.out/provenance-bypass.log`. It exists for a live outage that
   cannot wait for a push; the push follows. "1" and "true" are refused.
3. **A deployment carries the commit where the platform allows it.** The Vercel deployment is stamped `meta.gitCommitSha`. An edge function bundle has no metadata
   slot that can be proved without deploying, so a function is attributable through the pushed commit the guard insists on; that is stated rather than claimed.
4. **A connection to a provider is `active` only when the database can prove it works.** `integration_connections.state` is `active | unverified | dead | revoked`.
   The migration-1000 backfill reads only the office's own durable health row, never a secret value and never the provider: a fresh `ok` is `active`; `dead` naming
   `invalid_grant` is `revoked`; any other `dead` is `dead`; anything stale, ambiguous or absent is `unverified`. A trigger on `connection_health` then moves a
   connection with its credential's recorded health, in the one direction each state allows (it promotes `unverified`/`dead` to `active`, never un-revokes, never
   makes a second active, and cannot fail the health write).

## Consequences

- A deploy from a dirty tree, or from a commit that exists only on one machine, fails before any request leaves. The Sample's own deploy method (live bytes plus a
  staged diff) still works, because the staged change must itself be a pushed commit.
- Migration 1000 reads a little more than it did and does the same work afterwards; an `unverified` connection resolves nothing until the credential is next used
  and recorded `ok`, while the credential itself is read through the legacy name exactly as before. The state names are part of `integration_connections`'s check.
- The `ALLOW_UNPROVENANCED_DEPLOY` bypass is a deliberate, recorded hole. It is narrow, but it is a hole.
- This is a rule about SOURCE. It does not prove the code deployed is the code that was tested, and it does not read production; verifying a production ledger against Git
  still needs an authorised read.

## What would make this wrong

If a deploy must run from a machine with no git history (a clean CI image), the guard refuses it; the answer then is a checkout with the commit, not the bypass.
If Vercel stops accepting `meta` on a deployment the stamp is dropped by the platform, not by us, and the guard still holds.
