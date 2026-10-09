# System Health Report, 7 October 2026

Question asked: **is the Agentic Team actually working properly?**

Basis: local, isolated and replica evidence only. After the single Tier 1 read-only production pass (R1 to R5, see
`TIER1-PRODUCTION-EVIDENCE-2026-10-07.md`) there was no further production contact. Nothing was deployed. Migrations
1023 to 1026 and every other second-wave fix remain in the branch, undeployed, so **production still has the original
defects those fixes address**. No real model, Telegram, Slack, Google, Notion, Vikunja, Whisper or browser UI was exercised;
where behaviour depends on them it is marked UNPROVEN or PARKED, never guessed.

How to read the evidence: PROVEN = driven and seen locally. INFERRED = read in code, not driven. PARKED = needs production or
a live provider and awaits your approval.

## The proof census (my own re-run, clean state)

Before: 108 proof scripts, 53 passed, 55 failed. After repair: **112 scripts, 101 pass, 11 red** (re-run by me on fresh clones
of the candidate schema, not taken from the agents).

| Remaining red | Why | Verdict |
|---|---|---|
| office-ownership, office-ownership-sabotage, ownership-composite-fk, p3-app-attack | Refuse to run on a generic clone by design; they need `p2-attack.sh`, `p3-attack.sh` or a pre-0654 template | Pass when run the intended way (96/96, 74 ok, 39 ok, 1,421/1,421, per the tenant-isolation agent; not re-run by me) |
| compat-0600, job-skew, fresh-replay | Assert an old schema or an empty database by design | OBSOLETE TEST as written (fresh-replay does pass on an empty database: 802 migrations, schema fingerprint identical) |
| backup-restore-typed | Needs its `.sh` wrapper and `MIG_FLOOR=1027` | HARNESS DEFECT (55/55 when run properly) |
| audit-closure | Stale fixture, several raw inserts without `office_id` | STALE FIXTURE, **not yet repaired** (covers B11 may_act, B14 parent-written-once, #343) |
| e2e-tasks, e2e-convergence | New drivers; red on purpose because they found product defects | FINDINGS (below), not test faults |

Classification of the original 55 reds, by what the agents established and I spot-checked: about 45 STALE FIXTURE (inserts
that predate NOT NULL `office_id`/`project_id`), 4 INFRASTRUCTURE/HARNESS DEFECT (wrong build mode, a door emulator that
omitted the auth user id, tooling), 3 OBSOLETE TEST, and **0 GENUINE REGRESSION and 0 GENUINE PRODUCT DEFECT among them**. No
assertion was weakened. Detectors were shown able to fail by sabotaging clones of the schema (for example forcing
`harness_job` false turned `chat-containment` 2 of 4 red; forcing the operator gate open turned `p1-operator` to
0 of 19 refused; setting `suggest/2` to proceed turned 3 of 18 red). The proofs that matter most were red only because
nothing runs them: `npm test` (5,722 passing) does not include them. **They are still not in any gate, and `run-all.sh` is
itself stale.**

## What works (proven locally)

- **Tenant and office isolation**: 96/96 office attacks, 1,421/1,421 application attacks, 83/83 principals, 39/39 sender
  authorisation, 44/44 approver identity, 27/27 anon surface; a second person reaches none of the 19 operator actions.
- **Approvals**: raised for outward and destructive acts; only the owner can approve; bound to the exact action and question;
  spent once; a typed "yes" binds to the right question; forwarded, paraphrased or external-assistant text never counts as the
  owner. A level-3 action can never proceed on any dial (database CHECK plus a dial-by-tool matrix).
- **Human-contact boundary**: no outward path without a gate. Gmail has no send code at all. A 720-cell policy matrix passes.
- **Jobs and recovery**: one claim per job, stale claims fenced, all 18 stallable states recover, exhausted attempts fail with a
  reason and tell the person once, one broken job cannot stop the office, duplicate webhook/job/child give one of each.
- **Channel convergence**: Telegram text, Telegram voice note, Slack, Team HQ chat and the call's turn endpoint all write the
  same ledger (command, job `office.instruction`, same office, same task writer). No adapter decides.
- **Documents and retrieval**: txt, md, html, docx, PDF, long files, images, malformed and hostile files ingested; retrieval is
  project- and office-scoped, excludes archived/disconnected/harness rows.
- **Provenance and learning**: project provenance 20/20, who may state a rule 7/7, harness traffic kept out of his plan and
  briefing, the seven policy decisions behave as decided (Vikunja, Slack channels, Notion, rotation, learning, retrieval,
  proactive autonomy).
- **MCP server**: per-office isolation across 13 tools, no delete tool, revoked clients refused.
- **Budgets**: per-office spend with two offices, overspender's background work held, a person's conversation never parked.

## What partly works

- **Tasks**: create, mine vs team, categories, subtasks, complete, delete, search, sort, provenance, retry de-duplication
  and forwarded-content containment all proven. The natural-language front end has the defects below.
- **Reminders**: work when a time is stated. A date-only reminder never fires (defect R1).
- **Telegram voice notes**: stored and queued exactly like text. Whether production can transcribe them (`voice.transcription`
  seeds as `none`) is PARKED.
- **Team HQ**: backend proven; the browser UI was not run in this pass; chat memory resets on a page reload.
- **Scheduled duties**: the engine is proven; a second real person is seeded no duties (D1 below).
- **Model fallback**: gpt-oss to qwen to mistral falls through a 429, a malformed body and a network error; a hung model has no
  timeout and the free tier is unreachable inside one call.

## What does not work (deterministic path, model stubbed; likelihood in production unproven)

| # | Defect | User impact | Likelihood | State | Minimal fix |
|---|---|---|---|---|---|
| R1 | "Remind me Friday to X" with no time sets a due date and **no `remind_at`**, so the reminder duty never sends it. Very likely why none of his real tasks has a reminder | The reminder he asked for never arrives | High (natural phrasing) | LIVE | Default `remind_at` to 09:00 local on the date when the verb is "remind" |
| R2 | "Mark the roofer task done" completes it **and also files a junk team task** ("the roofer task done"), replying "Added it" (same for "Cancel the venue task") | Junk tasks and a false confirmation | High | LIVE | Let a state-change match veto the create |
| R3 | "Remind me to X every Monday" drops the recurrence and leaves "every" in the title; a recurring reminder with no due date loses it on the next run | A daily or weekly reminder silently becomes one-off | Medium | LIVE | Parse "every <weekday>"; derive next `remind_at` from `remind_at + repeat_every` |
| S1 | The false-send detector misses natural phrasings: "Email sent to Kevin, cc'd your accountant", "Emailed Kevin the report", "I've shared it with Kevin", "The report has been sent" were all **missed** (I reproduced 4 of 7 missed). No code can send mail | He may believe an email went out when none can | Depends on model wording | LIVE gate | Widen `claimsToHaveSent` (passive and channel-noun forms) and flip the nine `it.fails` tests |
| N1 | A retryable send failure on a finished answer is never retried automatically (delivery stays `claimed`) | An answer lost after a Telegram 429/5xx until he presses retry | Moderate | LIVE if transports mark failures retryable | Re-drive lapsed `claimed` deliveries from `drain` |
| H1 | Team HQ conversation memory is keyed on the page visit | "Yes please" or "do that again" loses its antecedent after a reload or across devices | High | LIVE | Key HQ memory on person plus project |
| Z1 | Time zone hardcoded to Athens in four places; the task counters bucket Today/Overdue in UTC while the task list uses Athens | About 3 h a day of wrong Today/Overdue for him; wrong for any second person | Low for him | LIVE (harmless in Athens) | Read a per-office zone |
| D1 | `provision_person_office` seeds no duties | A second real person gets no briefing, reminders, Drive/Notion/calendar duties | Certain once a person exists | LIVE, dormant until then | Seed person duties at provisioning |
| C2/C3 | `say_once` records "said" and a reminder is marked sent **before** delivery | A failed send is suppressed for 20 h; a lost reminder is not re-sent | Low-medium | LIVE | Mark on delivery |
| T1 | `my_task_set` edits team tasks, though delete refuses | Minor | Low | LIVE | Add the team filter |
| M1 | Model router has no per-request timeout | A hung provider stalls a turn for minutes | Low-medium | LATENT | Add a timeout |
| I1 | `needsClarification` is computed and never acted on | "Ask rather than guess" is decoration; one specialist just answers | Constant, low harm | LIVE | Act on it or delete it |
| P1 | PDFs with only numbers or under four words are declined as unreadable; binary under a text MIME is indexed as garbage | A real short PDF is "not searchable" | Low | LIVE | Gate the heuristic on a font mapping miss |

## What has not been proven

- **Any real model behaviour**: "Handle this for me", "Keep working on this while I'm away", "Ask the team to investigate this",
  multi-step planning and delegation depth. Routing and gates are driven; what the model then says and decides is GREY.
- **Real Telegram, Slack, Gmail-read, Google, Notion, Drive and Vikunja traffic**, transcription, realtime WebRTC audio,
  live MCP OAuth consent, the browser search parser, the Deno edge runtime, real Supabase Auth and RLS under PostgREST.
- **The Team HQ UI** in a browser (not run this pass).
- **The `tasks.remind` push to his phone**, and whether R1/R2 happen in his real traffic (a production read: PARKED).
- **Why `office.notion_sync` has failed 45 times since 16 Sep**, and whether it still does (PARKED).
- The current worker-versus-schema skew matrix (the skew proofs are obsolete and nothing replaced them).

## Broken only in tests

The 55 red isolated proofs (stale fixtures and harness defects; all but the few listed in the census table are now green); two obsolete skew proofs; a
vacuous final check in `approval-execution` (passes with zero deliveries); a second line of defence in `approval_verdict` that no
proof pins; `run-all.sh` and `p3-sabotage.sh` (rewrites repo files in place, not run); biome format errors on about 10 new or
edited proof files; two hostile-PDF unit tests that time out under CPU load.

## Broken in the product

R1, R2, R3, S1, N1, H1, Z1, D1, C2/C3, T1, M1, I1, P1 above, plus: uploaded file bytes are in no backup and the backup is in the
same project (D7, dormant); Notion's credential is deployment-level so a second person's Notion duty would throw (D8, dormant);
Slack uninstall leaves the status "connected" (F-06, low).

## Currently dangerous

Nothing found that makes normal single-owner use unsafe. The two items closest to dangerous are **S1** (a false "I emailed X")
and **N1** (an answer silently lost). Everything outward is gated and the audit found no P0. The only dated risk is Storage:
backups are never pruned and fill it about 23 to 28 October at the measured rate (database 73.9%, Storage 45.2% on 7 October).
That is not an emergency. Retention is **recommended, not authorised**, and nothing was deployed or deleted.

## What can wait

Security headers (B-06), MCP token lifetime (B-07), non-read-only check flag (B-10), the Sample visitor key (B-03), unfenced
derivative documents (D2/D5), management API write retries (G-4), runbook and rollback hygiene, per-office Notion, MCP
usability (F-01), calendar purge, and the multi-user items (Telegram relink F-05, Sample rule storage A-3) until a second real
person arrives.

## Subsystem status

| Subsystem | Status | Why |
|---|---|---|
| Chief of Staff | AMBER | Routing sound; false-send gate leaks (S1); clarification flag unused (I1) |
| Specialist delegation | AMBER | Roster, fan-in and routing proven; whether the model convenes the right people is GREY |
| Planning | GREY | Validator tests pass; multi-step planning needs the model |
| Jobs / worker | GREEN | Claim, fence, recovery, fairness, fan-in driven; real loop with a real model not run |
| Approvals | GREEN | 16 proofs, sabotage-checked |
| Autonomy | GREEN | 720-cell matrix; level 3 never proceeds |
| Telegram | GREEN | Door, ledger, redelivery, strangers; real send not driven |
| Telegram voice notes | AMBER | Same path as text; transcription setting PARKED |
| Slack | AMBER | Strong locally; uninstall status stale (F-06); real API not driven |
| Team HQ | AMBER | Backend proven; UI not run; memory resets on reload (H1) |
| Realtime voice | GREY | Only `/voice/turn` proven; audio, token mint, WebRTC not |
| Tasks | AMBER | Core proven; parser defects R2, R3 |
| Reminders | AMBER | Work with a time; date-only reminders never fire (R1) |
| Documents | GREEN | Real gateway, hostile files bounded |
| Retrieval | GREEN | Scoped, owner control in every check |
| Browser / research | AMBER | Address guard proven; live search parser and DNS rebinding unproven |
| MCP | AMBER | Server logic proven; unused in production; consent PARKED; F-01 |
| Google / Notion integrations | AMBER | Local proofs green; Notion sync failing in production (cause PARKED) |
| Multi-user isolation | GREEN | Strong local proof; real RLS and Auth emulated only |
| Security | AMBER | Gates proven; headers, tokens, Sample hardening open |
| Provenance | GREEN | Proven, harness kept out of his views |
| Failure recovery | AMBER | Recovery proven; no automatic redrive of failed sends (N1) |
| Notifications | AMBER | Once-only and containment proven; retries beyond apology path unproven |
| Model routing / fallback | AMBER | Chain proven; no timeout (M1); fourth model unreachable |
| Budgets | GREEN | Two-office proof; caveat: free-model use never binds |
| Scheduled duties | AMBER | Engine proven; none seeded for a second person (D1) |
| Backup / recovery | AMBER | Restore 55/55; upload bytes not backed up (D7) |
| Capacity | AMBER | No emergency; Storage fills about 23 to 28 Oct without retention |
| Test architecture | AMBER | 5,722 unit tests green; critical proofs outside any gate |

## The three questions

**1. Can I start using Agentic Team normally today?** Yes for you as the single owner, with four habits: give reminders an
explicit time; do not trust "Mark it done" to be clean (check for a stray task); treat any "I emailed/shared/sent" as untrue
(the office cannot send email); and glance at the Notion mirror, which has been failing. Nothing found makes normal use unsafe.

**2. The five biggest things that would actually affect you.** (1) Date-only reminders never fire, and "every Monday" is
dropped. (2) "Mark X done" also files a junk task. (3) The office can claim it emailed someone when it cannot. (4) A momentary
send failure can lose an answer until you press retry, and a hung model stalls a turn. (5) Notion mirroring has failed 45
times since 16 September for an unknown reason, and Team HQ forgets the conversation when you reload.

**3. Before calling this Version 1 reliable.** Fix R1, R2, R3, S1, N1, H1 and M1; investigate the Notion failures; put the
repaired tenant-isolation, approval and job proofs into a maintained gate and retire the two obsolete skew proofs; seed duties
for a second person and thread the time zone; then, as an operational decision of yours, back-up retention and an off-project
backup of uploaded file bytes. None of this is authorised or deployed.
