# Production deployment — release candidate `4ef3068b`, 29 September 2026

Grant authorized the controlled deployment and acceptance of the exact
candidate `4ef3068b` on branch `claude/agentic-team-integration-rc-dx8x7e`,
which is #373 + #371 + #375 and is described in
`docs/integration/release-candidate-2026-09-29.md`. This file records what
production changed from and to, every acceptance result, the incidents, and
the reconciliation. `main` = `4ef3068b` plus this record and the migration
ledger; no other change.

## What changed in production

| | Before | After |
|---|---|---|
| Migrations | 612, latest `0599` | **613** — `0600` only, applied once, exit 0 |
| `worker` | v841 | **v844** (deployed as v843; +1 when `deploy:voice` rewrote shared secrets) |
| `voice` | v555 | **v558** |
| `voice-token` | v585 | v588, from unchanged source |
| `ai-team-hq` page | `dpl_GwmxkoNNac7MmfKia4VWVmxszdFD` | **`dpl_H8GvmjbPjqhhNdeP1RWSYk3rd2fq`** |
| Other functions (`hq-api`, `slack-events`, `telegram-webhook`, …) | code as recorded | **code unchanged**; version +2 from the secret writes, as on 28 September |
| `agentic-team-hq-basecamp` experiment project | — | untouched |

**No secret or setting changed value.** Before each deploy, and again after
the worker and after voice, all five values the commands write were compared
with production's by SHA-256 digest only: `HQ_MANAGEMENT_TOKEN`,
`HQ_PROJECT_REF`, `WORKER_KICK_SECRET`, `HQ_API_TOKEN` and
`VOICE_ALLOWED_ORIGIN`. All were EQUAL. `HQ_PROJECT_REF`, which is not
secret, was the control that proves the digest format.

**Deployed code is the candidate's:**

- The fetched `voice` body contains 3 strings that exist only in `4ef3068b`,
  and not main's origin line.
- The fetched `worker` body contains 3 candidate-only strings, and not the
  line only main's `worker.ts` has.
- **The page** was deployed as production's own 185-file source tree, reused
  by digest. Every one of the 181 reused files was downloaded and its bytes
  proved to hash to production's digest. Exactly 4 entries were replaced:
  `chat.js` and `call.js` at `/` and `/studio/`, and production held main's
  bytes for each. No `projectSettings` were sent (the framework is still
  `null`). The new tree equals the manifest, and the public URL serves the
  candidate's bytes for the 4 entries and main's for unchanged files.
  `deploy:hq` was not used.

## Acceptance

| Area | Check | Result |
|---|---|---|
| 0600 | 1 row; both columns and the CHECK present; 643 blockers valid (0 stamped, 0 attempts); no jobs or deliveries triggered | ✔ |
| worker | liveness, 401 unauthenticated, one tick; the deployed sweep's own SELECT runs on the migrated schema and selects 0; 0 failed, 0 stalled | ✔ |
| voice | 401 unauthenticated; a question answered from state; CORS preflight and mint | ✔ |
| **#373** 1–3 | the real deployed page, signed in, one visit, typed A1 B1 A2 B2 (A = `ai-team-hq-test`, B = Unnamed) | stated A B A B, filed A B A B; conversation keys `<session>/A` and `<session>/B`; `conversation_before(A2)=[A1]`, `(B2)=[B1]` ✔ |
| #373 4 | A3 sent on A, then the browser moved to B mid-flight | filed on A; A's history holds A1–A3 and B's holds only B1–B2 ✔ |
| #373 5 | could B answer A's question | the jobs of B2's conversation, which is exactly what the #374 lookup reads: **only B's**, so a yes or no in B cannot reach an A question ✔ (end to end with a real blocker: isolated invariant 10) |
| #373 6 | live call on the deployed page (loop-back peer; `/turn` answered locally, nothing forwarded) | both hand-offs state A, including after moving to Unnamed ✔ |
| #373 7 | Telegram and Slack | no channel/enqueue file changed; their code timestamps unchanged; no Telegram/Slack inbound in the window ✔ |
| delegation | children of the acceptance turns | all on their parent's project ✔ |
| **#371** | the 3 questions the acceptance's pursuits raised (all harness) | asked once each inline; `asked_at` stamped, `ask_attempts = 1`, delivery `suppressed`; **not re-asked across ~12 minutes of worker ticks** ✔ |
| #371 | the deployed sweep query against production, one harness question, 11 states, each in a do-block that raises (nothing committed) | **11/11**: lapsed claim → asked; in flight, sent, failed, suppressed → left; no row: never tried → asked, 5 min → left, 11 min → asked, 2nd try 61 min → asked, 3 tries → left; answered → left. The real row was unchanged afterwards ✔ |
| #371 | concurrency | `deliveries_dedupe_key_key` unique in production; the two-connection barrier proof is in the isolated suite ✔ |
| **#375** 9 | `verify:pursues` | **47/47**; the `task.create` row's digest is identical before and after ✔ |
| #375 10 | `verify:basecamp-todos-live` | **25/25** ✔ |
| #375 11 | `verify:basecamp-addsource` | **9/10 ✘ — harness defect in the item-11 fix**: it reads the first `.bcsource`, which on the live Sources page is the miniature row (`bc/miniatures.js`, no `data-tone`), not the list row it was validated against. The product row does state its kind ("Something to read"). Teardown was clean |
| #375 12 | `verify:basecamp-live` against `ai-team-hq` | runs there for the first time. **33/34 ✘ (best of 3)**. The failing check expects document tiles on the portfolio home, and the current product draws **0** there by design (9 and 12 on project pages; confirmed offline), with bytes identical to main. It had only ever passed against the experiment host's older build. A team-page timeout hit 2 of 4 runs just after the deploy and did not reproduce in direct probes. Against its default experiment host: **34/34** |

Neither #375 failure is a product defect, and neither is in code the
candidate changed. Both are recorded on #375.

## Incidents

1. **Harness narration reached a real Slack channel: 11 posts** to the office
   narration channel `C0BVCESNS3G`. Five were the #373 acceptance turns, and
   six were `basecamp-live` and the voice deploy probe. The class predates the
   candidate: 381 of 523 narrations ever sent were of harness jobs, since 7
   September. `narrate.ts` filters `is_fixture`, not `app.harness_job`, and
   its delivery carries no job, so neither containment nor `check:leaks` sees
   it. Filed as **#378**. No Telegram message and no other human was involved.
2. **Acceptance rows are visible in the Unnamed project's Chat**: 5 rows (B1,
   B2, their answers and one question). `conversation_history` does not filter
   harness traffic; 6 earlier `deploy:voice` probe rows are already there. They
   were not removed: outputs are append-only, and the reviewed harness
   procedure has no removal for them.
3. The acceptance's three pursuits paused to ask for approval (`suggest`
   autonomy), which raised 3 questions and, by trigger, 3 tasks. By the
   reviewed `verify:pursues` teardown, the tasks were removed with
   `app.my_task_delete` and the jobs cancelled. The questions stay, as that
   suite leaves its own, hidden from needs-me as harness.
4. The page briefly served `bc/*.css` as `text/plain` once, just after the
   alias switched. Re-checked: `200 text/css` on both paths.

## Reconciliation (05:46 → 06:43 UTC)

| | Δ | Explained by |
|---|---|---|
| migrations | +1 | 0600 |
| jobs | +46 | harness pursuits (`verify:pursues` plus the acceptance's 3), all cancelled; 11 harness instructions (the acceptance's 5, `basecamp-live`, the deploy probe), all complete; scheduled duties. 0 live, 0 failed, 0 paused at the end |
| blockers | +5 open | the acceptance's 3 and `verify:pursues`' 2, all harness, 0 visible in needs-me |
| deliveries | +34 | 20 `suppressed` (containment working) and 14 `sent`: 11 are the narrations above; 3 are ordinary duty results (mail and calendar) to Grant's usual Slack and Telegram destinations |
| tasks | 0 | the acceptance's 3 were removed; `check:leaks`: 0 harness tasks on his list |
| projects | +2 | `fixture-pursue-*-pn4kmfpn`, archived, from `verify:pursues` (permanent by ADR-0022, as on every run) |
| inbound commands | +11 | the acceptance's 5, `basecamp-live`'s 5, the deploy probe's 1 |
| contacts, autonomy settings, tool permissions (digest), known escapes | 0 | unchanged |

`check:leaks`: exit 0, **0 new escapes** (it cannot see narration, #378).
Nothing historical was cleaned.

## Rollback point

- page: `dpl_GwmxkoNNac7MmfKia4VWVmxszdFD`;
- voice and worker: redeploy from `1095b04`;
- 0600: leave in place (additive; the old worker ignores it).
