# New environment

**Read this first, then [`HANDOFF.md`](HANDOFF.md), then
[`known-problems.md`](known-problems.md). Nothing else.** Three documents is
the whole onboarding, on purpose — a reading list nobody finishes is a reading
list nobody reads. The spec, the ADRs and the test evidence are reference; go
to them when one of the three sends you.

**The first three were run in a clean container on 2026-09-07** and are green:
583 unit tests pass, the secret scan is clean across 297 files, and the
inventory reports 8 credentials working, 2 dead, 3 outstanding.
`npm run verify:db` was not re-run today — the last full pass was 2026-09-05.

---

## Four commands

```bash
npm ci                # Node 22
npm run verify        # lint, typecheck, migration check, 583 unit tests, secret scan — no network
npm run inventory     # which credentials actually work, and whose account each hangs off — live
npm run verify:db     # all 15 live suites in order, ~300 checks — about 25 minutes
```

The first two need nothing but the repo. Run them before you believe anything
else about the working tree.

`npm run inventory` is the third because **no document in this repo is
authoritative about credentials** — it goes and asks the vendors. Believe its
output over any table, including the ones in the other two documents.

`npm run verify:db` is last because it is long and because it needs the job
queue to itself: `verify:slack` and `verify:worker` refuse to start rather than
produce misleading red. If a suite leaves debris behind,
`npm run purge:fixtures -- --go` clears it. Individual suites run on their own
(`npm run verify:hq`, `verify:telegram`, …) and that is usually what you want
mid-change.

## Two environment variables

| | |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | `sbp_…`. The one variable that must be present. It executes DDL and reads the vault, so it is the highest-blast-radius credential in the project |
| `SUPABASE_PROJECT_REF` | which project to point at. Every script falls back to the real ref when it is unset, so an unset value is normal, not broken |

Everything else — Slack, Telegram, OpenRouter, backup keys, the HQ token —
lives in **Supabase Vault** and is fetched at runtime with those two. Do not
add credentials to the environment to make something work; put them in the
vault, where `inventory` can see them and the backup gap is already documented.

Both come from the session environment. There is no `.env` to create, and
`.env*` is gitignored precisely so nobody tries.

**You cannot reach Postgres directly from a build session** — the environment
has no non-TCP egress, so everything goes over the Supabase Management API
(ADR-0007). That is the environment, not a workaround to remove.

---

## Seven habits this codebase learned the hard way

Each of these cost a shipped defect. They are here rather than in a style guide
because every one was written *after* the bug, and the bug is the argument.

**1. Ask what a check would do if the feature were deleted.** If it would still
pass, it is not a check. This defect has arrived in eleven costumes so far — a
hardcoded literal, a query against the wrong column, a test running as the wrong
role, a fixture blocked by an earlier gate, an assertion on a function's return
value rather than its consequence. When a check could pass vacuously, add an
explicit `CONTROL` assertion that proves it discriminates. The live suites are
full of them and they have all earned their place.

**2. A test that changed real configuration must put it back.** Three
instances. A permissions check left `gmail.send` enabled. A prompt-versioning
test rewrote a real role's prompt. A gate fixture left a **global mute that
silenced every routine notification for three days** — nothing was broken and
nothing was arriving, which is the worst shape a bug can take.

**3. A failing check that notifies nobody is indistinguishable from a passing
one.** The backup restore rehearsal failed twelve nights running, correctly and
loudly, into a place no human looked. If a scheduled thing can fail, it pages
Grant, or it is decoration.

**4. Take no shortcut the database would have allowed.** The rule in
[`src/jobs/worker.ts`](../src/jobs/worker.ts)'s header. A worker knows what it
is doing — it wrote the output, so why re-read `reviewer_status` — and every
such shortcut turns an enforced invariant into an honour-system one *while the
enforcement stays green, because nothing exercises it any more*. The worker
once moved jobs to `complete` with the reason "delivered" while delivering
nothing at all.

**5. Test both sides of an interface against each other, not against their own
expectations.** Six §12 buttons shipped dead: the composer invented a wire
format the adapter never parsed, and each side was green against itself. Two
components agreeing with themselves is not an integration test.

**6. A credential that is present is not a credential that works.** `npm run
inventory` found `GROQ_API_KEY` returning 401 and nobody knew. `GEMINI_API_KEY`
is still set and still dead, which is worse than absent — anything testing
`if (key)` believes it has a credential. Check credentials by using them, and
delete the ones that lie.

**7. A secret printed once is a secret rotated.** The HQ deploy script printed
its API token into a transcript. The token was rotated, the script can no
longer print it, and `npm run hq:token` sends it to Grant's phone instead.
There is a secret scanner in `npm run verify` for the same reason. Never echo a
credential, not even to prove you have it.

---

## What surprises people

- **Postgres is the system**, not a store behind it — the ledger, the queue, the
  state machine and the enforcement are all in there. Adapters translate and
  never decide; the database refuses illegal transitions rather than trusting
  callers not to attempt them.
- **Every vendor above it is replaceable**, which is why a Google account ban
  cost three project references and one document rather than the project.
- **Team HQ is read-only** by decision, and Telegram can never reconcile an
  interrupted send — a bot cannot read its own sent messages back, so it parks
  forever rather than risk sending twice. Both are in `known-problems.md` under
  accepted limitations; neither is a gap to close.
