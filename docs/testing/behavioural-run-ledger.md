# Behavioural discovery — durable run ledger

**This file exists so a compaction, or a fresh Claude context, can resume the
programme without losing its objective, its evidence, its stopping criteria or
its outstanding investigations.** Read it after `CLAUDE.md` and
`docs/AUTONOMOUS-RUN.md`. Append to it at the end of every pass, before
anything else.

## Objective

Discover, diagnose, fix, verify and deploy meaningful **backend behavioural and
reliability defects** found through realistic multi-turn use of the office, and
continue without waiting between iterations until a defensible stopping point
is reached.

Not in scope: frontend or UX work, merging to `main`, clearing the Issue
backlog. **Known Issues are not the work queue.**

## The loop

DISCOVER -> CLASSIFY -> ESTABLISH CANONICAL TRUTH -> ROOT CAUSE -> FIX IF
JUSTIFIED -> VERIFY -> SABOTAGE -> RECONCILE -> DEPLOY -> VERIFY THE DEPLOYED
WORKER -> CLEAN UP -> DISCOVER AGAIN.

Every surprise is classified before it is acted on: **PRODUCT / INSTRUMENT /
EXPECTED BEHAVIOUR / STOCHASTIC VARIANCE / UNKNOWN**. A red or green result is
not evidence until the check has been shown to observe the intended mechanism
and to fail under sabotage.

## Stopping criteria

**Five consecutive qualifying clean passes** across materially different
behavioural territories, then **one final adversarial synthesis pass**. A pass
qualifies as clean only when it:

1. exercised a materially different territory from the previous passes;
2. ran multi-turn, against the deployed worker, not only in unit tests;
3. produced canonical evidence (job rows, outputs, obligations, deliveries),
   not model narration;
4. classified every surprise;
5. demonstrated its own checks could fail under sabotage;
6. left no debris and no new synthetic-to-real escape;
7. found no meaningful systemic PRODUCT defect.

If the final adversarial pass finds a defect: fix it, **reset the count to
zero**, and continue.

## Containment — STOP THE LINE

No harness traffic may reach real Telegram or Slack, alter real preferences or
lessons, create tasks Grant can see, contaminate real dashboard projects, or
trigger uncontrolled external side effects. The two preserved #298 escapes are
**evidence and are never rewritten to obtain green**; they are acknowledged in
`public.known_escapes` and `check:leaks` reports them as *known historical* and
fails only on *new*. **Any new synthetic-to-real escape stops the programme.**

## Pass ledger

### Pass 0 — `long-day`, twelve turns, two projects (deployed v781)

Territory: long sessions where state changes repeatedly; dictated language;
memory-dependent work; corrections; changed intent.

**NOT CLEAN — two systemic PRODUCT defects, both fixed.**

- A status question convened two more specialists and spawned a second
  synthesis, because `aboutTheWork` read the resolver's rewrite while the
  action it guards reads Grant's own words. Third instance of the
  **grounding-asymmetry** class (after `namedLater`, #322).
- *"Write me a document on..."* and *"I want a one-pager"* were not recognised
  as artifact requests at all, so the office answered "I could not carry it
  out" over a capability it holds.

Filed and closed as **#327**. Verified live on v781: turn 1 produced 0 children
and an obligation answer; turn 2 produced one `artifact.report` child.

Clean-pass count after pass 0: **0 of 5.**

### Pass 1 — deliberate retries, repeats and cancellation (deployed v783 → v784)

Territory: idempotency crossed with deliberate retries; repeating a request;
the authorisation that permits duplication. Materially different from pass 0.

**NOT CLEAN — three systemic PRODUCT defects, all fixed.**

1. **The clause that authorises duplication read a paraphrase.**
   `wantsAnotherGo` was reading the thread resolver's rewrite. Driven live,
   both directions occur: a deliberate retry lost, and one manufactured.
   Fourth instance of the grounding-asymmetry class, and the first where the
   rule is asymmetric — a guard that PERMITS may not read a paraphrase at all.
2. **A reminder to make something was read as a request to make it now**
   (#325, closed). Both recognisers fire on his own words; the artifact
   reading won and the reminder was never added.
3. **A repeated request was narrated as deduplicated and started anyway.**
   `alreadyOn` gated the roster hand-off and `planAndPursue` and not the three
   branches that start work.

Evidence: `scripts/poc/resolver-vs-retry.ts` (the live resolver against four
elliptical retry fragments) and `npm run verify:another-go` (three real turns
through the deployed worker; it found defect 3 on its first honest run).

Sabotage: seven in total across the three fixes, each printed as landed and
each turning the intended checks red.

Measured frequency: zero occurrences of `again`, `remind` or an artifact
deferral in Grant's 313 real messages, against a control finding `report` 5
times and `task` 9 — so the filter works and these shapes have not yet arisen
in a corpus this size. All three are features he asked for, and the
consequence of each is silent: duplicated work, or work silently replaced by
different work.

Also classified, and **not** defects: eight real specialist answers finished
after their parent and were never delivered — five `notebook.generate`, two
`notebook.add_source` (mechanical steps the parent relays, `announce=false`)
and two belonging to `verify:escapes`' deliberately real-looking positive
control. EXPECTED BEHAVIOUR and INSTRUMENT respectively.

Clean-pass count after pass 1: **0 of 5.**

### Pass 2 — the preference lifecycle: scope, withdrawal, attribution (v785 → v786)

Territory: what the office has LEARNED and how it can be told to stop —
materially different from passes 0 and 1, which were about work in flight.

**NOT CLEAN — three systemic PRODUCT defects, all fixed.**

1. **A cancellation had been a standing rule in every prompt for eight days**
   (#330). `STANDING` in `teaching.ts` contains the bare word `never`, so
   *"Okay, never mind about that."* was stored at 0.95 confidence,
   `learned_by grant`. `remember()`'s own comment names that exact sentence as
   something a fix prevented; the fix was elsewhere and it would have been
   stored again today. Fixed in three places: the code, a new gate check
   (`check:standing`), and the row itself, retired through
   `app.retract_lesson`.
2. **The office denied holding a rule that was in the prompt it answered
   from** (#320's invariant family). From inside a project, a global or staff
   rule is invisible to the withdrawal lookup, so taking one back answered
   *"I do not have a standing rule about that."* It now names the rule and the
   words that take it off, and `EVERYWHERE` is the narrow authorisation.
3. **Every retraction recorded the author as the reason and the reason as the
   author** (#331). `remember()` passed `app.retract_lesson`'s two text
   arguments the wrong way round. `lessons.is_fixture` is GENERATED from
   `learned_by`, so harness retractions were attributed as Grant's — 41 global
   and 34 project rows reading as real traffic. Named arguments now;
   `public.lessons` refuses UPDATE, so 0567 records the fact in column
   comments rather than pretending the rows can be fixed.

Evidence: `npm run check:standing` and `npm run verify:withdraw`, both in the
gate. The standing-rule fix is verified on the deployed worker by a live turn:
*"Okay, never mind about that."* now stores nothing and the office answers
*"There was nothing still running on that, so there is nothing to stop."*

Sabotage: five, each printed as landed and each turning the intended checks
red.

Also classified, and **not** a defect: a preference stated while a project is
in scope is stored project-scoped regardless of how universally he phrased it.
The say-back tells him — *"for this project"* — which is ADR-0017's rule
working, so it is EXPECTED BEHAVIOUR with an honest correction path.

Three harness mistakes in this pass, all caught before they became findings: a
withdrawal sentence naming no dimension the office knows; a teardown guessing
a `retired_at` column on a ledger that records retirement as a row; and a
multi-edit script that asserted and wrote nothing. A `git checkout` on an
uncommitted file also threw away one edit, which is the first trap in
CLAUDE.md.

Clean-pass count after pass 2: **0 of 5.**

### Pass 3 — what real traffic actually contains (v788)

Territory chosen by reading Grant's 313 real messages rather than by guessing a
third time. Two territories were considered and dropped on measured frequency
first: project switching mid-conversation has happened **once** in real traffic,
and no real message contains "again" or "remind".

**NOT CLEAN — one systemic PRODUCT defect, the most consequential of the run,
because Grant reported it himself. Twice.**

**An instruction he stated arrived in the prompt labelled "not rules — weigh
them"** (#332). He taught the office to answer in bullet points on 11
September, complained on the 20th, and complained again on the 21st. The rule
was stored, live, at 0.95 confidence and reaching the brief — under a heading
calling every lesson a belief from past work, beside ones a specialist had
inferred at 0.50. `guidanceFor` selected `body`, `scope` and `observations` and
dropped `learned_by`, which is the only fact separating an order from a guess.

Measured: 14 of 32 substantial real answers since he taught it used a list;
**0 of 4 on the days he complained**. After the fix, driven through the
deployed worker, **3 of 3**.

Fixed by correcting the label rather than adding a paragraph — the prompt
already tells the model to honour his standing instructions, and a second
paragraph arguing the same point is what #277 is a complaint about. Which
lessons are his is derived **from the roster**, so it cannot go stale when a
channel composes his name differently.

Also in this pass, and **not** defects: the project spine deliberately shows a
harness job the harness's own world, which is why fixture projects appeared in
a harness answer; and `check:callers` was red because migration 0534 arrived
from a sibling branch through the sanctioned reconciliation path while its
callers did not — baselined with that as the stated reason, which self-corrects
when the branches meet.

One defect of my own making: two aborted runs left four ACTIVE fixture projects
in `public.projects`. Swept through `app.project_delete`, and both new suites
now arm their sweep the moment there is something to sweep rather than at the
bottom of the file.

Clean-pass count after pass 3: **0 of 5.**

### Pass 4 — corpus archaeology (not a qualifying pass)

Read Grant's own task-related turns against canonical state. **Two apparent
defects, both already fixed, and one live containment violation.**

- The task on his real list titled *"For me and the um... No actually, you know
  what? Scan the entirety of the Legacy Coaching Project…"* — the disfluency
  and the withdrawn clause in the title. Reproduced deterministically:
  `readRetraction` reads the pivot correctly and `personalTaskRequest` on the
  kept clause returns null, correctly. **#291 fixed it on 21 September; the row
  was written on the 20th.** Residue, not a live defect. Left alone: it is his
  list, and a title is his to correct.
- *"Could you point me to the project or task board where they're logged?"* —
  asked at 08:34 on 20 September. The fix supplying his tasks as canonical
  state landed at **14:28 the same day**. Already fixed.
- **Live, and fixed here:** *"Chase the printers gmzvgkuw"* was on his real
  open list — a task he can see, written by a crashed run of
  `scripts/poc/call-it-x.ts`. The containment brief names creating tasks he can
  see as a violation. `check:leaks`' detector wanted a token mixing letters and
  digits, and roughly one run token in fifteen holds no digit. Swept; the
  looser reading now PRINTS the titles rather than counting them, proved by a
  control inserted and removed.

**Does not qualify as a clean pass:** it was archaeology against stored
evidence, not multi-turn driving against the deployed worker. Recorded as such
rather than counted.

Clean-pass count after pass 4: **0 of 5.**

### Pass 5 — the whole session corpus against v788 — **CLEAN**

Territory: 113 recorded turns across forty-odd sessions, run against the
deployed worker. Chosen because the corpus already covers the delegation
follow-ups real traffic contains, so a new session there would have duplicated
it; what it had never been given was a run against today's changes.

Re-ran from scratch the four sessions that exercise this run's work
(`again-on-purpose`, `again-accidental`, `again-after-stopping`) and the two
turns the report flagged as **recorded against an older commit and therefore
not to be believed** (`d302-dictated`, `disc-preference-scope`).

**340/340 expectations held across 113 turns.** No systemic PRODUCT defect. The
two previously-failing turns were stale, not live: both pass on the current
commit.

Containment: `check:leaks` exit 0, 0 new escapes, and `session --sweep`
reversed the four tasks the runs left (4 -> 0).

**Qualifies as a clean pass.** Multi-turn, against the deployed worker, scored
against canonical state (job state, who answered, project, task counts), every
surprise classified, nothing left behind.

Clean-pass count after pass 5: **1 of 5.**

### Pass 6 — the duties, and what the office sends unprompted

Territory: the work the office starts by itself. It is most of the queue by
volume (951 `drive.watch`, 355 `tasks.remind` in seven days) and had not been
touched by passes 0–5, which were all about turns Grant starts.

**NOT CLEAN — a false record in the standing brief, and a whole class with no
witness** (#333). No live PRODUCT defect: the duties are healthy, nothing is
failing, and `tasks.remind` delivering nothing across 355 runs is correct,
because no live task carries a due date or a reminder time.

- **`CLAUDE.md` said Grant was spared the #477 burst. He was not.**
  `public.deliveries` holds 756 rows for `office.provision_channels`, `sent`,
  telegram, `target_ref 1386648496` — his real chat — 746 of them on 17
  September. Ruled out as a stub because the message references share a
  contiguous sequence with `google.read_mail` and `tasks.remind` deliveries to
  the same chat on neighbouring days. Corrected in place with the evidence.
- **Nothing watched the class.** 0477 bounded that one enqueuer;
  `check:leaks` only asks about harness traffic and `app.office_health()` only
  reports failures, stalls and waiting work — a duty that runs perfectly and
  sends perfectly is none of those. `npm run check:chatter` is the witness, in
  the gate, ceiling 100 a day per kind against a busiest honest duty-day of 48,
  replies printed but never bounded, and it carries its own positive control
  drawn from the incident rather than a synthetic row.

Clean-pass count after pass 6: **0 of 5** — reset, because the pass found
something meaningful.

### The diminishing-returns question, answered from this ledger

Findings per pass: 2, 3, 3, 1, 1, 0, 2. The yield has not fallen away, and the
single finding in pass 3 was the largest of the run. Continuing is justified by
the evidence rather than by appetite.

### Pass 7 — what the morning briefing actually says to him (#334)

Territory: the one surface that reaches Grant every day without him asking.
Read by opening the sentences it sent rather than the code that composes them.

**NOT CLEAN — two systemic PRODUCT defects, both on his highest-trust
surface, both fixed.**

1. **The failure section contained nothing but fixtures**, for five days.
   `app.recurring_failures` returned exactly two rows and both were
   `verify:notice` debris — a suite that attaches its proof to a REAL job on
   purpose, so 0491's guard cannot see it. Fixed at the reader (0568): the
   office writes signatures only as `app.failure_seen(job.kind, …)`, so a
   genuine one always names a kind some job has run, and the whole table was 2
   rows of which 0 did.
2. **The headline number was 94% test traffic.** *"54 items are waiting on
   you… 50 more sit on the dashboard"* — 67 open blockers, 63 raised by
   suites, four his. `public.needs_me` had no harness filter and has EIGHT
   consumers, so the dashboard and the voice answer said it too. Fixed in the
   view (0569) with its companion (0570), because without the second the two
   halves of one sentence counted different populations.

`verify:autonomy` went red and was asserting an artefact — count equality as a
proxy for "the view does not truncate". 0570 made them one population again, so
it is valid without being weakened. `verify:briefing` now asserts the invariant
every run as a property, with a control.

Three harness mistakes on the way, each caught by driving: three upserts in one
statement all read the pre-statement snapshot; this executor returns the FIRST
statement's result; and `failure_seen` blanks a subject containing a space. The
last left a real `drive.watch` signature in his briefing for a minute, swept.

Also swept: six retired harness specialists `check:leaks` named, from this
run's session corpus.

**A sabotage this environment would not allow.** DDL against the shared view is
declined, correctly. What stands in its place is each migration's own
raise-unless-true drive block and the suite control — recorded here rather than
left implied.

Clean-pass count after pass 7: **0 of 5.**

### Pass 8 — his correspondence (#335)

Territory: mail — the most personal corpus the office holds, and untouched by
passes 0–7. Entered the way pass 7 did: by reading what the office actually
sent him, then by asking what it would SAY.

**NOT CLEAN — two systemic PRODUCT defects on the same guard, both fixed.**

1. **The number that decides coverage was dropped at the boundary.**
   `app.mail_coverage` has always computed `associated` — how many messages a
   project actually matches — and the `MailCoverage` interface did not carry
   it, so the note decided from `contacts`/`aliases`: *could* it match, not
   *did* the search cover anything. Live: all five active projects match ZERO
   of 274 cached messages and every one has at least one alias, so the note
   was suppressed on **100% of real projects**. Pass 3's class exactly — what a
   column knows is worth nothing if the code that builds the prompt does not
   select it.
2. **The document path was never told anything.** `handlers/artifact.ts`
   called `mailBlock(post)` with one argument for the life of the feature. The
   class fix is the parameter's DEFAULT: removing it turned a silent omission
   into a compile error at every site.

The original guard's argument — *a caveat on every turn is one nobody reads* —
is kept rather than overridden; it was being decided by the wrong number.

Four harness or reading errors on the way, each caught before it became a
finding: `count(*)` over a JSON array counted the array; a `mail_coverage(null)`
reading generalised to every project (**the correction produced the real
finding**); an invented `associated` field in a test fixture, caught by tsc; and
a sabotage that printed `replaced: 0` because the signature had been
reformatted onto one line — its green was the sabotage failing, not the check
working.

Also classified, and **not** defects: `google.read_mail` announced to him for a
four-day window in September and has been quiet since, which is a deliberate
past setting rather than a break — mail is still storing today; and its
announce condition correctly never fired on "nothing new" (0 of 65).

Noted, not fixed: *"Mail refreshed: 11 messages, and 3 ones no longer there"* —
a grammar defect in a message he receives. LOCAL, low consequence.

Clean-pass count after pass 8: **0 of 5.**

## Pass 9 — what the office cites

**NOT CLEAN.** One systemic product defect: [#336](https://github.com/granterogers/agentic.team.grant/issues/336).

Territory: the citation, from the database column to the line printed on a PDF.

**Canonical evidence, before any theorising.** 5,814 citations across 5,094
real answers since 1 September. Five of them carry the scheme `null` —
`null:b8f72c15-… Legacy Coaching Course — Current Status Report` — and two are
in real `artifact.report` outputs from 17 September. `report.ts` renders a
source as `label — ref`, so the word **null** was printed on the sources page
of a PDF he opens.

**Root cause.** `documents.connector` is nullable and all ten null rows have
`origin = 'made'`: they are the documents this office produced. So the null is
not missing information — it is the one case where the office cites its OWN
work and had no word for it. Three sites interpolated the scheme
independently, so none of them could be fixed once.

**Fix.** `citationRef()` is the single formatter; a null connector resolves to
`made` or `unknown`, never `null`. `Hit` carries `origin` so retrieval can
answer the question. `isUntrusted` accepts a null connector and returns false
for it — a document this office wrote is not somebody else's material and must
not be fenced as an injection risk.

**Verification.** Eight assertions wired to the CALL rather than the import
name. Three sabotages, each printed as landed, each red: the raw connector
interpolated again (4 failed), one PDF list reverting to a template (1), a made
document fenced as untrusted (1). Deployed, then driven against the live
database: 14 citations across his four active projects, **0** naming null.

Clean-pass count after pass 9: **0 of 5.**

## Pass 10 — what he hears when a turn of his dies

**NOT CLEAN.** One systemic product defect: [#337](https://github.com/granterogers/agentic.team.grant/issues/337).

Territory: the blocker/approval round trip, and then — where the evidence
actually led — the terminal failure of a turn a person asked for.

**Three harness assumptions challenged and dropped before any product change**,
which is most of what this pass was:

1. *"457 real blockers resolved"* — **450 were "Resolved by the verification
   script"**, harness traffic `app.harness_job` cannot see. The real answered
   corpus is 7, all completed, the four approvals each spawning a child. The
   approval path works.
2. *"Real provider outages never reach the pause path"* — built on a classifier
   that matched the word *unavailable* inside an unrelated refusal sentence.
   No real outage in 30 days. Dropped rather than built on.
3. *"Four real turns of his died silently"* — one is a `Simultaneous probe`,
   two have no inbound row at all. **One is genuinely his**, and it is worth
   more than the four: a **17-second voice note** to his real Telegram chat on
   8 September, `Buffer is not defined`, attempt 4 of 5, **zero deliveries**.

All 224 `job_pauses` rows are harness — no real job has ever paused — so that
territory has no real-traffic frequency and was left alone.

**Root cause.** Every terminal failure in `worker.ts` ended
`moveTo(job, 'failed')` and returned. #211 taught the coherence gate to record
an *impediment* — a Governance-page row, a screen he must go and look at — and
stopped one layer short of CLAUDE.md's own rule: *anything that can end a turn
with no answer has to say so somewhere he looks.*

**Fix.** `app.owed_a_word` (0571) decides in SQL who is owed a sentence, so six
gates share one definition; `src/jobs/lastword.ts` composes it in code with no
model call, says the attempt failed rather than that the office cannot (#320),
and knows a spoken message from a typed one. Wired at the single tick seam.
Containment inherited from `claim_delivery`, asserted not assumed.

**Verification.** The migration drives the reader against the real voice note,
with two controls — one of which failed first time because `office.%` matches
`office.instruction`, the kind his own messages arrive as. `verify:lastword`
10/10 live. Ten unit tests. **Six sabotages, each printed as landed, each red.**
A **vacuous control was found and repaired mid-pass**: `capabilityLies` given
`EMPTY_CAPABILITY` had nothing to lie about and stayed green under a sabotage
that denied capability outright.

**Limitation, recorded not forced.** No observed terminal failure through the
*deployed* worker: the reproduction reached `retrying` and the environment
declined the shared-table update needed to exhaust it. Not forced, per the
standing rule.

**Containment after the pass.** `app.harness_escapes()` reports exactly the two
preserved #298 escapes, both `known`, both predating this work. Zero new;
refused 257.

Clean-pass count after pass 10: **0 of 5.**

## Pass 11 — his tasks, and the reminder that has never reminded

**NOT CLEAN.** One systemic product defect fixed (#321's retraction face);
two filed on their own evidence ([#339](https://github.com/granterogers/agentic.team.grant/issues/339),
and a comment on [#321](https://github.com/granterogers/agentic.team.grant/issues/321)).

Territory: time, tasks and reminders — the highest-frequency duty that can
message him.

**The found-nothing question, asked first.** `tasks.remind` runs every fifteen
minutes and has **never sent him anything**; every output says *"Nothing to
remind you about."* That is the shape CLAUDE.md warns about — a check that has
only ever reported zero is indistinguishable from one that cannot report
anything. It is **truthful**: seven real open tasks and **not one carries a due
date.** The duty is correct and the corpus is empty.

**What the corpus contained instead.** One row, from a voice note on
20 September:

> *"For me and the um... No actually, you know what? Scan the entirety of the
> Legacy Coaching Project and create appropriate tasks for me to review"*

stored verbatim as a task title, false start and self-correction included, and
read back to him as *"That is on your list — …, no date on it yet."*

**Two defects in one row, and the first was already half-fixed.** `taskTitle`
already carried a retraction fix citing this exact task — so I tested it rather
than filing a duplicate, and it was **wrong on the sentence its own comment
quotes**: the title came out *"the entirety of the Legacy Coaching Project
and…"*, verb gone. Cause is a composition, not either half: `requestBody` takes
the verb BY POSITION because its contract is that a request clause opens with
the asking verb, and a retraction survivor opens with the instruction's own.
Fixed at the seam, gated so the ordinary path is provably untouched.

**The generalisation was tried and reverted.** #321 asks for the verb to
survive everywhere. Using `OBJECT_NOUN` as the discriminator generally broke
six tuned frames ("remind me to…", "put a to-do on to…"), so it was reverted
and the finding recorded on #321 — the negative result is the useful part.

**The second defect is the reading, not the title** (#339): he asked the office
to GENERATE tasks and it RECORDED one. Zero children; the project was never
scanned. Same family as the settled making-outranks-enumerating precedence.

**Verification.** 29 unit checks on the title path, two sabotages both printed
as landed and both red (always strip: 2 failed; never strip after a retraction:
1 failed). Full suite 3,007. Deployed, then driven through the deployed
gateway: `verify:mytasks` reached **75 ok**, including *"the framing is out of
the title, so the list is scannable"*. It did not complete — it exceeded the
ten-minute ceiling, which CLAUDE.md already records for this suite, and one
unrelated check failed on the known live-worker/suite coupling. A timeout is
not a result and is not reported as one.

**A test expectation corrected, not deleted.** The prior assertion
`toBe('the entire project')` was deliberate and honest — it characterised the
defect and named #321 beside it — so it became `toBe('scan the entire
project')` with the history kept.

Clean-pass count after pass 11: **0 of 5.**

Filed on the way past, not fixed:
[#338](https://github.com/granterogers/agentic.team.grant/issues/338) —
`vault-export`'s wrong-passphrase check fails about one full run in three and
passes alone every time. #226's shape, on a SECURITY assertion.

## Outstanding investigations

- ~~**#325**~~ — closed in pass 1. The collision was demonstrated on his own
  words and does not need the resolver at all.
- **`verify:escapes` leaves two children attributed `telegram:grant`.** Its
  teardown rewrites its parents and not the work they handed on, so two jobs
  sit permanently in every "real traffic" query. Measurement contamination
  rather than an escape — nothing was delivered.
- **#326** — `check:migrations` passes while migrations are applied to the
  shared database but absent from this branch.
- **#321** — `taskTitle` borrows `requestBody`'s object extraction as a title.
- **#319** — the contested-intent cap; evidence only unless real traffic shows
  routing harm.

## Invariants earned in this workstream, not to be regressed

- **#320** — the office must not deny a capability the deployed system can
  actually perform in that context, and must keep *cannot* / *needs something*
  / *this attempt failed* / *done* distinct.
- **#318** — `npm run delegation` may return an honest INCONCLUSIVE.
- **#313/#322/#327** — a veto must be at least as grounded as the thing it
  vetoes.
- **#298** — containment, and its preserved evidence.
