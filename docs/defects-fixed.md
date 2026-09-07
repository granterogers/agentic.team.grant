# Defects found and fixed

**What this is.** Every defect this project has found in itself, with what was
wrong and what closed it. Twenty-six so far.

**Why it is kept.** Not as a trophy cabinet. This project's method is that a
check earns its place by failing, and the failures are the part worth reading —
each row below is a shape of mistake that will be tempting again. The recurring
one has appeared in fifteen costumes and is worth learning by heart:

> **A check whose result does not depend on the thing under test.**
> When you write one, ask what it would do if the feature were deleted. If it
> would still pass, it is not a check — add a CONTROL that proves it
> discriminates.

Three siblings, each learned the expensive way:

- a test that changes real configuration must restore it;
- **a failing check that notifies nobody is indistinguishable from a passing
  one**;
- a check that reads a *copy* of the thing under test is reading a stale copy.

Live problems are in [`known-problems.md`](known-problems.md). This file is
history; nothing here is outstanding.

---

## The list

| What was wrong | What closed it |
|---|---|
| The backup rehearsal had **never passed** — 12 runs, 12 failures, silently | vault stand-in in the rehearsal target; **now pages Grant on failure** |
| A test left a **global mute** that suppressed every routine notification for 3 days | migration 0036; gate-3 cleans up after itself; the suite clears its own |
| The worker moved jobs to `complete` with reason "delivered" while **delivering nothing** | a real notifier; the state reason now reports every channel's actual outcome |
| A 👍 was attributed to **the wrong output** — resolved by correlation, which spans jobs | migration 0037: deliveries record the job |
| Six **dead buttons** — the composer invented a wire format the adapter never parsed | both sides now tested against each other |
| A correlation written into a column with a **foreign key to `events`** | left null; the work is resolved from the message instead |
| The HQ deploy script **printed its token into a transcript** | rotated; the script can no longer print it — `npm run hq:token` sends it to Telegram |
| `verify:credentials` **broke the live Slack install every run**: it upserted the production row with its probe secret reference, then deleted that secret at cleanup. Nothing failed until `slack:rotate` refused, days later | the lifecycle checks run against a probe row (`A0PROBELIFE`) and never touch the install; a 19th check fails the suite if any reference is DANGLING; `npm run slack:repair-refs` repairs one |
| `npm run inventory` reported the Slack config token dead **minutes after a successful rotation** — it probed the environment copy, which rotation never updates | it resolves the token from the vault, where rotation writes it |
| Slack channels were named `proj-<slug>` — unambiguous, and in Grant's words "a bit strange". A sidebar is read by a person | plain English from the project's name: `#ai-team-hq-test`. `slack:rename-channels` migrates the ones that already exist |
| The Chief of Staff bot token lived **only in an environment variable**, against §15, so three senders each needed it in their own environment | it is in the vault, the registry (0054) holds its identity, and `ask`, `hq:token` and the backup pager all resolve it from there |
| The router made **one attempt at one model**. On a free tier, being rate-limited is a model's normal state, so one 429 failed the whole job while four other models sat in the registry marked usable | failover across up to three candidates, each tried once; proven live by injecting a 429 and watching a different model answer |
| §31's exit criterion — the same instruction through two interfaces produces the same command "modulo three fields" — **could not hold as written**: `actor` is channel-native, and Slack cannot say a Telegram id | identity is resolved rather than exempted. 0056 maps `(origin_channel, actor)` to a person; 0057 makes a trigger fill it for every writer, so a new channel gets it by existing rather than by remembering |
| The new chaos suite's first check passed **three times for three wrong reasons** — no Slack destination mapped, then a foreign key on a fabricated job id, then a fabricated output id. Each time "Slack is broken" was indistinguishable from "the fixture was wrong" | a real job, a real output and a real channel mapping, so the only remaining reason to fail is the injected outage — which the note now names (`indeterminate:ECONNREFUSED (injected)`) |
| **A job that crashed after committing was re-run from scratch**, producing a second output — precisely the duplicate substantive work §18 forbids. Recovery special-cased `committed` but not `notifying`, and a worker spends microseconds in the first and a whole Slack call in the second | 0058 keys on the evidence (an output row) rather than on a state name; 0059 restores the state rule alongside it, because `committed → retrying` is illegal and the evidence rule alone could not know that |
| And nothing read the `notifying` state, so a correctly-recovered job would have parked there forever — the same "sweep to nowhere" as the requeue 0006 was written to close, one layer up | `deliverPending` claims and finishes them, and runs before new work in every drain |
| `verify:cross-interface` could pass **exactly once**: its Telegram message id was a constant and its Slack `ts` was built from five base-36 characters that only change every forty seconds, so the second run collided on the dedupe index and read as a product defect | both fixture identities come from the full clock, and the cleanup deletes by the derived dedupe keys rather than only by the run stamp |
| 0054 seeded the pager's username from the roster document (`atg_chief_bot`) rather than from `getMe`. The real one is `@agenticteamgrantbot` — a registry naming a bot nobody can open is worse than one with no name | 0055; the roster records an intention, the API records a fact |
| `slack_channel_map` claimed nine channels were live that Slack had archived — every run whose cleanup was interrupted left one. A mapping that names an archived destination is worse than none | the rename script reconciles against Slack, which is the authority on archived |
| A **channel with only the bot in it**: the office provisioned its first real project channel, posted into it, and Grant saw nothing. 56 Slack checks passed because each asks whether the message arrived, none whether it arrived to anyone | the provisioner invites the human (0050); a 57th check reads the membership back |
| The intent classifier could not read a **bare imperative** — "Research X", "Draft Y" matched no rule and fell through to an unconfident `thought`, which convenes nobody | a `bare-imperative` signal at `light_investigation`, with a CONTROL for the same verbs used as nouns |
| Renaming `notebook_sources` broke `app.project_attention()` and surfaced as a **502 from Team HQ**: a function body is stored as text, so it does not follow a rename the way a view does | 0053 recreates it; `verify:schema` now fails on any function naming a relation that does not exist, and was itself proven to discriminate |
| 0051 made the uniqueness index partial for uploads but left the columns `not null`, so the case the index was written for **could not be inserted at all** | 0052; found by `verify:knowledge` on its first run |
| The same partial index then broke the sync's `on conflict` target — one run stored **zero rows** and said nothing | the conflict target carries the index predicate |

| Team HQ's endpoint documented a fixed list of sections and did not have one: `SECTIONS['constructor']` and `SECTIONS['__proto__']` are truthy through the prototype chain, so three inherited names passed the guard and reached a fetch of `/rpc/undefined` with the service key | `Object.hasOwn`. Nothing leaked — the value came back undefined — but the endpoint's own comment claimed a property it did not have, and `verify:security` now probes all three against the deployed function |
| Retrieval ANDed every word of a question. Asking *"what does our material say about the difference between coaching and mentoring?"* returned nothing from a corpus whose one document is a long article about coaching and mentoring — because "material" and "say" appear in neither | 0060 adds `p_match`: `'all'` for a deliberate search, `'any'` for a question, with `ts_rank` sorting so more matches win. Both semantics are asserted against the same corpus, because each is wrong in the other's place |
| The Chief of Staff, asked in Telegram to *"generate an audio overview in our Google notebook"*, **wrote a paragraph describing one**. Everything worked except the part Grant asked for: the bot received it, the router picked a speaker, retrieval ran, both surfaces delivered — and `office.instruction` had no way to reach the notebook handlers that already existed | `src/agents/actions.ts` reads an instruction for the artifacts it asks for and the handler enqueues them. Deterministic, not a second model call: the failure mode of a model deciding is a slide deck nobody asked for |
| The task id a generator returns **IS** the artifact id. Assuming otherwise, the collector matched by "which artifact is new" — and handed the slide deck's artifact to the audio overview's collector within one minute of going live, hitting a uniqueness constraint | `external_ref` is the task id, recorded when the generation starts. What a sibling has already claimed is also excluded, and the claim is a guarded update rather than a blind one |
| The adapter had its **own artifact-status table** — `3` ready, everything else pending. The library says in as many words that the integers must not be read directly, because PENDING and PROCESSING were transposed on the wire in an earlier release. Ours read "in progress" as finished and announced a slide deck with no link | `status_str`, `is_completed`, `is_failed` and `ArtifactType`, from the library. The table that replaced them had no row for a mind map and quietly never found one |
| A finished **mind map has no URL, ever** — it is interactive and lives inside NotebookLM. "Complete with no url" was read as "not ready", so a finished artifact was polled until the watch gave up: it never delivered the thing and never said why | anything finished without a file of its own links to the notebook, and the message says which kind of link it is |
| Each poll of a generating artifact hung off the previous one, so the **fourth was refused at §9's delegation cap**. Correctly refused: polling is not delegating | ticks are siblings under the generation that started the work, at a constant depth |
| A follow-up job had **nowhere to reply**. `inbound_commands` is keyed on the job that received the message, and the job carrying the artifact link is two steps away — so the one message Grant actually wanted would have gone only to Slack | the reply channel and the staff attribution both walk the parent chain, so the artifact arrives from the person who was asked for it |
| 0011 said *"a message carries an instruction; a button press carries an action, never neither"*, and 0075 added voice notes without noticing that rule was still there. A recording satisfied the new constraint and was refused by the old one — reported as a 503, which Telegram began retrying | 0076 drops the superseded rule. Each migration is correct alone; the defect is entirely in the pair, and only a real recording through the live webhook found it |

---

Full accounts, with the reasoning at the time, in
[`test-evidence/`](test-evidence/) and in the commit messages — the commits are
the better read, because each was written while the defect was still fresh.
