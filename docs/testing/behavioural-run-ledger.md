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

## Pass 12 — the office denying what it was handed

**NOT CLEAN.** One systemic product defect fixed
([#342](https://github.com/granterogers/agentic.team.grant/issues/342)); one
filed ([#343](https://github.com/granterogers/agentic.team.grant/issues/343)).

**Territory chosen from where his traffic actually goes**, not from a list of
plausible ones: 238 real `office.instruction` turns in 30 days, every other
kind in single figures.

**The finding.** On 23 September he asked *"what projects have we got"* **six
times**. Five answers listed his four dashboard projects. The sixth, at 16:37,
said *"I can't list any projects — I have no record of them in our database…
if you can point me to the source (Notion page, Drive folder, etc.)"* — the
office asking him to find a Notion page listing the projects it reads from its
own table. Metadata byte-identical across all six.

**Why it is systemic and not variance.** The four names were in the prompt.
Every gate allowed it for a defensible reason: `assertsRecordsUnseen` asks
whether a lookup RAN (projects was consulted AND complete, so the office was
entitled to speak) and `EPISTEMIC` exempts any sentence framed as what the
office knows, which is how a denial is phrased. **Nothing ever compared what
was SAID against the state SUPPLIED.** `projectSpine`'s own comment records
this failure once already; its fix reduced it without removing it.

**Fix.** `deniesWhatItHolds` — a domain held WHOLE whose census is non-empty
may not be described as empty. 0304's asymmetry makes it safe: it can only
fire when the census is non-empty, so an honest absence can never be
suppressed, and `documents` stays excluded because a search is not a census.
The count is passed as DATA, never parsed out of the canonical sentence.

**Calibrated, not reasoned.** Against 133 real delivered answers the first
version fired 3 times with **2 false positives**, both on the singular
"project" used as a modifier. Tightened to the plural; **1 of 133, zero false
positives**, and both false positives kept as controls.

**The third sabotage stayed GREEN**, and that was the useful one: nothing
asserted the handler actually supplies the census, so the gate would have gone
silently inert. Wiring assertion added, bounded at both ends; it then went red.

**A containment near-miss, recorded.** A probe enqueued through the real path
came back `is_fixture = false`, `requested_by = telegram:grant` — because
`enqueue_inbound` composes that from **subject**, not actor, and I had put
"grant" in subject. Caught by asserting containment BEFORE the job ran; stop
requested, and the one delivery was `suppressed`. **He was spared partly by a
fake chat id, which is luck.** Re-run correctly with the fixture name in
subject: `is_fixture` true and `deliverable_to` his chat false before it ran.
The misfired job's attribution was corrected in teardown and asserted.

**Deployed verification.** The same question driven through the deployed
worker as contained harness traffic: all four projects, correct, one attempt,
delivery suppressed. The gate could not be observed FIRING there, because the
denial is roughly one turn in six and not forceable — recorded as an inherent
limitation rather than a skipped step.

**Containment after the pass.** `check:leaks` **green**: 0 new escapes, 269
refused, only the two preserved #298 rows. It is no longer permanently red on
that evidence, which #322 had noted.

Clean-pass count after pass 12: **0 of 5.**

## Pass 13 — delegation, and the instrument that measures it

**NOT CLEAN.** One systemic product defect
([#345](https://github.com/granterogers/agentic.team.grant/issues/345)).

Territory: delegation, chosen because CLAUDE.md records the historical state as
five of eight agents never selected and `delegation_depth` 0 everywhere.

**Delegation is now healthy, and the measure said so.** 7 of 8 agents chosen,
30 parent jobs fanning out to 56 children all finished, consultation rate 7.8%,
median latency 21s. The 15.3-hour worst wait is the known 13–14 September
outage; second-worst since is 0.1h.

**Two leads chased and both dropped on evidence.** `finance-director` has never
been chosen — but the subject matcher scores them top on a finance question
(3), the ceilings were opened to them by #230/#232, and only 3 of 89 real
delivered instructions name finance first. Two of those three predate the
ceiling fix, and the third — *"bring Finance in on that"* — was answered
*"I can't bring Finance in **without knowing what she found**"*, which is
#320's "needs information" state and legitimate. **Dormancy is a small corpus,
not a defect.**

**The finding was in the instrument itself.** `npm run measure` printed
`evidence blocks 0 (the anti-hallucination gate firing)` — every time it has
ever run. It counted `kind = 'missing_data'`, and **no gate has ever written
that kind**: all four `app.cannot` sites in `worker.ts` write `not_capable`
and identify themselves by `noticed_by`. `missing_data` holds 112 rows, **none
real**, so the figure was zero by construction. The truth on real traffic is
**46 output-constraint refusals and 8 quality-gate refusals — 54 turns where
Grant asked and a gate stopped the answer**, reported to him as none.

Worst possible direction: a zero there reads as *the office never
hallucinates*.

**Fix.** Count by `noticed_by`, real only, printed as a LIST so it cannot go
silently to zero when a gate is added or renamed; and never a bare zero —
`NO IMPEDIMENTS FOUND` in words when nothing is found, which is `npm run
space`'s lesson applied.

**Verification.** 5 assertions on the query's SHAPE, not a count. Three
sabotages, each printed as landed, each red: reintroducing a hardcoded kind
(2 failed), replacing the found-nothing sentence with `0` (1), dropping the
harness filter (1). Run live: 46 and 8 where it said 0. No deploy — `measure`
is a script, not part of the worker.

Clean-pass count after pass 13: **0 of 5.**

## Pass 14 — retrieval: does the office find the right material, and only that

**CLEAN.** No defect found. The first qualifying clean pass since pass 5.

Territory: retrieval — the core of every answered turn, and not previously
probed in this programme. Five substantive probes, **each with its own
positive control**, because four of the five ask a found-nothing question and
this file records three occasions where a zero meant the instrument was blind
rather than the product sound.

1. **Does retrieval find material at all?** Searching each active project for
   one of its OWN document titles: `ai-learning` 1 hit, `ai-team-hq-test` 2,
   `legacy-coaching-course` 3. Four other projects hold no documents at all,
   which is stated rather than counted as a pass. **This is the control every
   result below leans on.**
2. **Is it silently missing material?** Of his real delivered answers that
   cited nothing, on a named project, with a substantial instruction —
   **0 of 24** had documents retrieval would have found. Every uncited answer
   genuinely had nothing to cite.
3. **Can one project read another's documents?** **0 leaks across 168
   cross-project searches**, each using another project's real document title,
   which is the hardest case.
4. **Do mirrors come back beside their originals?** 16 mirror documents exist
   in the estate; **0 duplicate titles across 60 retrieved documents**. 0169's
   rule is holding, and the corpus is non-empty, so the zero means something.
5. **End to end through the DEPLOYED worker**, contained: *"what do our
   documents say about the opening assessment?"* on his real Legacy Coaching
   Course project. One attempt, complete, answered from his real material with
   numbered citations and **five well-formed distinct sources** across two
   connectors — no `null:` scheme (pass 9's fix holding), no duplicates. The
   one pair that looked like a mirror was checked: both originals, a PDF and
   a Notion page, legitimately cited separately.

**Containment.** `is_fixture` and `app.deliverable_to(job, 'telegram', his
chat) = false` asserted BEFORE the job ran, not after — pass 12's lesson
applied. The turn left **0 documents, 0 children, 0 tasks, 0 deliveries to
him**; the one delivery was suppressed. After the pass: `check:leaks` green
with **0 new escapes** and 270 refused, `check:chatter` green.

**Two leads chased and dropped on evidence.** Messages about
`identity-proof-*` fixture subjects were sent to his real chat — 760 of them,
which is the known #333 `office.provision_channels` burst of 16–17 September,
already fixed by 0477 with `check:chatter` as its witness, and that witness is
green. And `app.harness_job` correctly reads those projects as real, because
`identity-proof-%` is deliberately not a fixture name under #45.

No code change, so nothing to deploy.

Clean-pass count after pass 14: **1 of 5.**

## Pass 15 — the undo, which is the net under "always check before destroying"

**NOT CLEAN.** One systemic product defect
([#346](https://github.com/granterogers/agentic.team.grant/issues/346)).

Territory: the reversal path. `public.undoable_actions` holds 377 rows, 376
expired and **not one ever used**; `undo_requests` is empty. That is the
found-nothing shape, so the question was whether the feature is unused or
unreachable.

**Three wrong theories dropped before the real one.**
`undo_offers` turned out to be a VIEW over the base table showing only live
offers, so zero *now* is expected. The 4-minute window with **0 of 377 having
any message sent for their correlation** looked damning until the kinds were
read: most are dashboard actions, where the undo id comes back in the action's
own response and a Telegram message would be wrong — a sound design, and the
page is out of scope. And `hq_overview_base` appeared to register a reversal
without returning an id; **my own regex had matched `undo_offers` inside its
overview count.**

**The real defect.** `app.hq_undo` dispatches on `reversal ->> 'action'`
through a CLOSED case and raises on anything else. **Six** action names the
writers record were missing: `contact_archive` (13 rows),
`contact_photo_set` (8), `contact_update` (10), `document_rename` (3) — and
`document_move` and `document_restore` with **no rows at all**. Pressing Undo
on any of the 34 raised out of a SECURITY DEFINER function.

The tell: `hq_undo` knows `contact_fields_set`; the writer records
`contact_update`. Two vocabularies for one set of things — 0311's defect, on
the mechanism his *"always check before making any destructive action"*
depends on. Every performer already existed; only the dispatch was missing.

**Fix.** 0572 teaches it the four with rows, spliced from the live definition,
asserting the property over the real 377. 0573 teaches it the two without,
asserting the same question **of the writers**. `npm run check:undo` is in the
gate with **both sides derived** — the names writers pass, and the names the
press performs.

**Reading the writers rather than the rows is what found the last two**, and
it paid on the first run: they have no rows, so no query over what had already
happened could ever have seen them. They would have raised the first time
Grant moved a document.

**Verification.** `check:undo` reports 17 offered by 16 writers against 19
performable, all covered. It has already **failed on real data**, naming both
orphans before 0573 existed — stronger than a synthetic sabotage. Both vacuity
guards sabotaged and proved: blinding either side reports `N offered, 0
performed` and refuses to pass rather than comparing nothing.

No deploy: a database function plus a script, and the gateway calls `hq_undo`
by name.

Clean-pass count after pass 15: **0 of 5.**

## Pass 16 — the review gate: approve, discard, and whether he can press either

**CLEAN.** No defect found.

Territory: #28's document review gate — chosen because CLAUDE.md records two
separate defects in it (`discard_document` writing a state the constraint
forbids, and `awaiting_review` filtering a state nothing writes), so it is the
place a regression would most likely have survived.

1. **`app.discard_document` now writes `archived`**, not the forbidden
   `rejected`. 17 archived documents are the evidence the path runs.
2. **`app.awaiting_review` agrees with the table.** Per project:
   `ai-team-hq-test` 1 awaiting against 1 made draft, every other project 0
   against 0. It first appeared to return nothing — **that was my own
   argument**: the predicate is `project_id = p_project`, and `= null` is
   never true.
3. **`app.approve_document` works** — 84 approved documents.
4. **Both buttons are reachable.** `check:pressable` is green: 85 actions and
   59 sections, 13 named by nothing in `web/`, all baselined and the baseline
   may only shrink. **Neither approve nor discard is among them**, so the 27
   CLAUDE.md records have since become 13 and these two were fixed.
5. **Driven end to end inside one rolled-back statement**: a made draft appears
   in the queue (1 row) → approve → state `approved` and **out** of the queue
   → a second draft → discard → state `archived`. Every assertion held; the
   closing raise rolled it all back and the teardown was asserted (0 projects,
   0 documents left, `check:leaks` green).
6. **The debris pile was measured rather than assumed**: 250 suite-subject
   projects not flagged `is_fixture` (#45 requires real names), all archived or
   paused, **none active**. The single "active" match was my own regex hitting
   the word *test* inside his real `ai-team-hq-test`.

Two of the six checks were wrong before the product was — the null argument
and the regex — which is now the commonest event in this programme.

No code change, so nothing to deploy.

Clean-pass count after pass 16: **1 of 5.**

## Pass 17 — voice, and the plan it makes of what he says

**NOT CLEAN.** One systemic product defect
([#347](https://github.com/granterogers/agentic.team.grant/issues/347)).

Territory: voice — the surface pass 10's defect surfaced on, and one he
actually uses. 27 voice notes, 25 transcribed; the two failures are one
deliberate fixture and pass 10's `Buffer` crash, now covered by `lastWord`.

**The finding came from reading what he SAID and what came back.** On
11 September he asked, by voice, for a new notebook called **Coaching for
Success**, research in it, a presentation, an audio explanation and the links.
The office said back only *"Make slide deck from it"* and *"Make audio
overview from it"* — *it* with no antecedent — then asked *"Shall I make it in
**Legacy Coaching Course**?"*, substituting the project he was scoped to. No
such notebook exists, no research was done, no links were sent. The blocker
recorded *"Carry out 2 steps"* for a five-clause request.

**And that exact sentence plans correctly today.** I nearly filed the
historical incident as a live defect; running it through `readPlan` showed
three steps AND `say-what-you-dropped` naming the research and the links. Do
not judge current code by an old output.

**The class is live.** Drop one word — *"Create a notebook called Onboarding…"*
rather than *"…Google Notebook project called…"* — and the creation clause
vanishes, the say-back reads *"from the sources in that notebook"* with no
antecedent, and it is NOT declared as dropped, because that mechanism reports
clauses it recognised and could not map, not one it failed to parse. Both
patterns required the literal word `project`; the `notebook` was the optional
half. Anchored to the one sentence he happened to use.

**Fix.** `(?:notebook\s+project|notebook|project)` in both. Safe because a
`project` step does not mean create — the resolver emits `use_project` when it
finds one and `create_project` only when it does not.

**Measured before shipping: 0 of 174 real messages plan differently.** No
regression and no new false positives; it opens shapes he has not used yet —
a defect waiting for its first user, invisible to any query over history.

**A sabotage that proved nothing, caught.** Reverting either pattern alone
left all five tests green, because the two are tried with `??`. Reverting BOTH
turns three red. A half-reverted fallback chain is not a sabotage.

**Deployed and driven end to end**, contained: the office now answers
*"⚠️ Start a BRAND NEW project called "Coaching Wellness Pilot" with a new
notebook — you have nothing by that name…"* with both artifacts bound to that
name. Nothing sent, nothing created, `check:leaks` and `check:chatter` green.

**A side effect worth recording:** `check:callers` went red because pass 15's
undo fix made `hq_contact_archive`, `hq_contact_photo_set` and
`hq_contact_update` reachable. The baseline may only shrink, and it did.

Clean-pass count after pass 17: **0 of 5.**

## Pass 18 — the diary, and the suite hiding inside his conversation

**NOT CLEAN.** One systemic product defect
([#348](https://github.com/granterogers/agentic.team.grant/issues/348)).

Territory opened on the calendar, which came back clean, and the finding came
out of the instrument used to check it.

**The calendar is sound.** 14 events, 6 ahead, fetched minutes before the
check; the duty ran 48/48 complete in two days. `calendar_ahead` IS called —
by `hq_overview` and `voice_answer`, SQL-to-SQL, which a grep of `src/` misses
and `check:callers` was right about. The conversational handler deliberately
does NOT read the diary and says *"I have no record"* rather than inventing,
which is the failure that actually happened; and **he has never once asked
about his diary in conversation** — 0 real turns — so the gap has no
frequency. `fabricatedWhen` still refuses both invented clock times and still
allows the derived £26, the £63.50 price and an honest absence, which are the
three false-refusal regressions on record.

**The finding.** Measuring how often that guard fires on real traffic returned
three hits — all *"Simultaneous probe"*. Quantified: **35 of 173**
`office.instruction` jobs `app.harness_job` called real were a test suite, and
only 12 look like a probe by name.

`harness_job` read three signals and a suite driving the real enqueue path
defeats all three by design — #45 requires real subjects, and
`enqueue_inbound` composes `requested_by` from the SUBJECT. The marker existed
and nothing read it: `inbound_commands.dedupe_key`. The namespaces separate
completely, and `verify` is the only one spanning three channels.

**It was a containment gap, not just a measurement one.** `claim_delivery`
asks the same function, so on 14 September six `verify:chaos` deliveries
reached a real Slack channel and **his real Telegram chat**, uncounted because
`harness_escapes()` asks it too. They predate the guard; the defect is that
the same run today would send them again.

**Fix.** 0574 adds the fourth signal. 173 → 138 real turns, 0 suite-signed
left, **0 real messages lost** — asserted, because a false positive here costs
him a delivery. `check:leaks` still green with 0 new escapes, and the pre-guard
bucket correctly grew 162 → 168: reclassified, not hidden.

**Deliberately still not caught**: four `verify:escapes` positive controls,
which are real-looking BY DESIGN — catching them would destroy the control.

**The guard against the next one** fails on any UNCLASSIFIED dedupe namespace
rather than guessing. It found the `asset` namespace on its first run — a
GENUINE dashboard message of his asking for a document review. The check was
right to stop; the answer was to classify it, not to call it harness. Proven
able to fire with a synthetic `probe:` command inside a rolled-back statement.

Clean-pass count after pass 18: **0 of 5.**

## Pass 19 — re-reading the instruments through the filter just built

**NOT CLEAN.** One systemic product defect
([#349](https://github.com/granterogers/agentic.team.grant/issues/349)) and one
**correction to a finding this programme itself published**.

**The correction first.** Pass 13's issue said *"54 real turns where Grant
asked and a gate stopped the answer"*. Both halves were wrong, and only
visible after pass 18's fix: the 46 `output constraints` refusals are all
**duties** (`office.notion_sync` ×30 and friends, 16–18 September, the fixed
provenance-order defect), and the quality gate's 8 became **7** once one was
recognised as suite traffic. The honest figure is **7 turns of his**, not 54.
`measure` now says WHOSE turn — *"a gate stopped an answer"* and *"an answer
OF HIS"* are different claims and the first was being made in the second's
words. 0394's lesson repeating: re-read your own evidence through the filter
you built afterwards.

**Of those 7: three recovered on retry and he got an answer; two failed
silently** — and `app.owed_a_word` returns nothing for both. That is how the
defect was found, not by looking for it.

**The defect.** Their `inbound_commands` row had been deleted. **Only suite
teardowns delete that table** — no product path, no retention sweep, no SQL
function. A job can never be deleted, so what survives is a job with no
evidence of whose turn it was: **68 of 206 counted as real**, 1,189 across all
kinds, newest today.

**Fix.** 0575 preserves the dedupe NAMESPACE on the job in a BEFORE DELETE
trigger. The first draft stamped `jobs.synthetic` and **the database refused
it** — *"synthetic is decided when the work is created and cannot be
changed… The defect this refuses is a suite rewriting its attribution around a
send."* That rule outranks the fix, so the trigger preserves evidence rather
than a verdict, add-only.

**A negative control could not be built, and that is the product being
right**: `stamp_synthetic_inbound` denies by default, so every command a
migration can insert is already synthetic. The first drive failed with
`A REAL TURN WAS STAMPED` — the fixture being wrong, not the trigger. The
mis-scoped-update control was built instead and holds. That same flag
corroborates pass 18 independently: **all 138 remaining turns have
`synthetic = false`**.

**The 68 are unrecoverable** and are not guessed at. `check:leaks` asserts the
property — nothing orphaned since 0575 may be counted as real — proved able to
fire by moving only its date bound, which returns 68.

**The migration needed a plpgsql subtransaction**: the first version raised to
undo its fixtures and took the DDL with it, applying nothing while reporting
success on its own marker.

Clean-pass count after pass 19: **0 of 5.**

## Pass 20 — skills and procedures, which reach every prompt in scope

**CLEAN.** No defect found.

Territory: what the office has been TAUGHT — chosen because CLAUDE.md records
a real defect here (an eight-clause work request filed as a global procedure
called *"Shoulding decide"*), and because a skill reaches every prompt in its
scope, so a bad one is expensive on every turn.

1. **The corpus is clean.** Three live skills — a global one on handling a
   request you cannot finish, a status-update procedure for the chief of
   staff, and a research procedure for the research director. No nonsense
   entry; the recorded defect is gone.
2. **`skills_for` selects by SCOPE, not by matching the condition**, so
   `when_to_use` is descriptive text the model reads rather than a predicate.
   That makes the global skill's vague *"Whenever it applies to the work in
   hand"* harmless rather than circular.
3. **They reach the right agents**, and the briefs are 928–2,199 characters —
   nowhere near the pressure the capability brief hit at its 4,000 ceiling.
4. **The one skill naming a tool its owner lacks says so in the prompt.** The
   research director's procedure lists `github.read` and
   `app.staff_may_use('research-director','github.read')` is false; the brief
   renders *"We do not currently hold github.read, so that part cannot be
   done. Do the rest and say plainly which part we could not do."* That is the
   offer-versus-press invariant working, in the prompt, computed through the
   authorisation path rather than around it (ADR-0017).
5. **`readTeaching` still declines a work request** that merely contains a
   conditional — #237's fix holding — and recognises a real conditional
   procedure, a standing preference and a method announcement.
6. **The 140-character floor on a BARE conditional was chased and dropped.**
   It genuinely blocks *"When you write me a status update, lead with what
   changed"* (76 chars) — which is word-for-word a live skill. But that skill
   was SEEDED (`from_job` null), not learned, and against his real corpus only
   1 of 5 conditional messages falls under the floor — a work request the
   recogniser correctly declines anyway. A method marker bypasses the floor at
   109 characters. No harm, so no change: **a latent gap with no evidence of
   the shape he would use is not work.**

No code change, so nothing to deploy.

Clean-pass count after pass 20: **1 of 5.**

## Pass 21 — Slack, the one real surface not yet probed

**CLEAN.** No defect found. One channel of debris swept from his sidebar.

1. **494 real Slack deliveries, all `sent`, none failed** — 6 September to
   today.
2. **244 channel mappings for four real projects**, which looked alarming: 235
   belong to archived projects, 227 of those to fixtures. **230 of the 235 are
   archived in Slack too** — the office does clean up after itself.
3. **Five looked live and only one was.** `slack:tidy`'s dry run lists 14 live
   channels and the four `chaos-*` are not among them, so Slack has them
   archived while `slack_channel_map.archived_at` is stale. That column is
   written and never read for a decision, so the staleness has no consequence
   — noted, not fixed, because a stale column nobody reads is not work.
4. **The sweep has both halves.** A name pattern (which `chaos-` would escape)
   AND 0477's property rule — *its project is archived* — which does not go
   stale the way a list of prefixes does. It planned the one real fixture
   channel correctly and it has now been archived: `zz_test_artifact_31014230`
   is out of his sidebar.
5. **Routing is correct.** An apparent 94-of-195 messages "in another
   project's channel" was **my own join**: `ai-team-hq-test` has TWO active
   channel rows, so 37+37 is one project counted twice. The real residue is 9
   messages from **9 September**, when `ai-learning` and
   `legacy-coaching-course` had no channel at all — theirs were created on 16
   September. A fallback, not misrouting.

Two of the five checks were wrong before the product was, which is now the
commonest event in this programme and the reason each one is chased to its
evidence rather than filed.

Clean-pass count after pass 21: **2 of 5.**

## Pass 22 — permissions and reach, on the authority boundary

**NOT CLEAN.** One systemic product defect
([#350](https://github.com/granterogers/agentic.team.grant/issues/350)).

Territory: what the office is allowed to do, chosen because CLAUDE.md records
a defect that hid *"on a security boundary for the life of the feature"*.

**The recorded defect is fixed and holds.** `app.guess_reach` now sees inside
every separator — `db.delete`, `delete_everything`, `purge_all`,
`crm_removeContact` all read destructive — and the asymmetry holds: a
reassuring description cannot soften a destructive NAME. 16 enabled tools, 5
read / 7 write / 4 external, **nothing at level 3**, and `db.delete` is level
3 and disabled.

**The finding is the other half of the same classifier.** The vocabularies
match `\m(delete|destroy|…)\M` — the exact word — and a tool description is
written in the THIRD PERSON, which is how every API reference writes one.
*"Deletes every record it touches"*, *"Permanently destroys the archive"*,
*"Wipes all local state"*, *"Charges the customer card"* all read `unknown`;
`offer_mcp_tool`'s own comment says *"unknown is treated as a write"* while
`destructive` becomes level 3 — the level `autonomy_policy` can never resolve
to `proceed` and which cannot take a standing authorization.

Proved on the same text: the old pattern is **false** on all three
third-person forms and **true** on the imperative.

**`mcp_discovered_tools` holds zero rows**, so nothing has been misclassified
yet. Second defect this programme has found waiting for its first user.

**Widening is escalation-only**, which is the safe direction on an authority
boundary: a false escalation costs a human decision on an unvetted third-party
tool; a false relaxation hands a standing authorization to something that
deletes. "queries" is still not recognised, deliberately — failing to see a
READ leaves it `unknown`, which is treated as a write.

**Verification.** The migration drives all seven shapes plus three controls,
including the one that must never move. Seven permanent assertions added to
`verify:connectors`, which owns this path: **52/52**. Driven against the
database rather than unit-tested, because the consequence is an authority
level.

Clean-pass count after pass 22: **0 of 5.**

## Pass 23 — the Governance page, and the instrument that hid half of it

**NOT CLEAN.** One systemic product defect
([#351](https://github.com/granterogers/agentic.team.grant/issues/351)).

**The proposals section is honestly empty.** All 22 rows are
`verify:proposes` fixtures and `app.harness_proposal` filters every one, so
the page shows none. My first measure said otherwise — it used
`harness_label`, which is not the predicate the reader uses. And the round has
nothing real to raise: `impediments_tally(14,3)` holds **only** `not_capable`,
and 0474 correctly skips that kind.

**The finding was the section beside it.** `public.suggestions` had never held
a row, because **nothing called `app.raise_suggestions`**. Run by hand it
raised three immediately.

**`check:callers` reported it reachable for as long as it has existed**,
because the only database mention was inside a COMMENT in
`app.decide_suggestion`. CLAUDE.md records `verify:schema` learning *"a
comment is not a call"*; it was never carried across to the check whose whole
job that is. **The repository half had the same hole and masked its own fix**
— a comment beside the new call named the function in prose, so removing the
call left the check green. Found only because my own control failed.

Stripping comments surfaced **four more** functions the product names only in
prose: `app.unarchive_document`, `public.model_speed`, `app.mail_recent`,
`app.notebook_chat_allowed`. Recorded with reasons, not fixed here.

**And what the round produced was broken in two ways 0474 had fixed three days
earlier**: *"We have been unable to an answer the database will accept 46
times"* — the template assumes a verb phrase and half of `needed` is a noun —
and it offered coherence-gate refusals as capabilities Grant might grant. Both
invisible because nothing had ever run it. The two defective rows were removed
from his page; the genuine third is kept.

**An ownership rule the fix made necessary.** Stripping comments briefly
turned the gate red over ANOTHER BRANCH's in-flight work: four `sign_in_*`
functions, from `0577_signing_in_without_pasting_a_credential.sql`, applied to
the shared database **six seconds after my own 0577**. A concurrent session.
Grants are `postgres`/`service_role` only, so nothing was exposed. The check
now skips a function no migration in this checkout creates, and self-heals
when that branch merges — `check:migrations` already models the same fact and
passes on 0539, 0543 and 0577 as cross-branch collisions.

**Two mistakes of my own worth recording**: I used `git checkout` on
`propose.ts` and destroyed an uncommitted edit — this file's FIRST recorded
trap — and I put backticks in a comment inside a template literal, which is
its most-recorded one.

Clean-pass count after pass 23: **0 of 5.**

## Pass 24 — backup and restore

**NOT CLEAN**, but the finding is a HARNESS defect rather than a product one:
[#352](https://github.com/granterogers/agentic.team.grant/issues/352).

Territory: the last untouched one, and the highest-consequence if wrong.

**The backup itself is in good order.** The duty ran 7 of 8 times in the last
week (one failure on 17 September), and `backup:rehearse`'s five checks all
pass: an archive exists, **124 objects checksum clean byte for byte**, it
decompresses into 123 tables, the next run would skip nothing, and the stored
copy is *honestly behind* by one table. That last check is the script at its
best — it noticed `public.sign_in_requests`, created minutes earlier by the
concurrent session, and reported drift rather than failing on it.

**What does not happen is the restore.** The script's own header says the
point is the data round trip into a scratch schema. Across runs at 480s, 590s
and 200s it never reaches `create schema`: `restore_rehearsal` does not exist
afterwards, and nothing is left behind. So the only part that proves a backup
is RESTORABLE does not run, and `verify:db` — which contains it — cannot
complete either.

**Ruled out**: API throttling (a plain query round-trips in ~2s), a DDL
problem (`create schema` through the same executor persists and drops cleanly
when driven by hand), and debris.

**A correction to my own reasoning, made before relying on it.** I inferred
from the five checks appearing in a 200s run that the checks were fast and the
restore was the slow half. That inference is unsound: piping stdout to a file
makes Node block-buffer it, so those lines may have been flushed at kill. The
likely mechanism — checks 1–3 fetching and checksumming **124 archive
objects** — is stated as a hypothesis, not a finding, and isolating it needs
timing inside the script.

Recorded rather than forced, which is what the brief asks for. The shape of a
fix is phases (`--verify` / `--restore`), since CLAUDE.md's rule is to SPLIT
what cannot finish in ten minutes and the script takes no arguments at all.

Clean-pass count after pass 24: **0 of 5.**

## Pass 25 — the connectors that feed everything

**CLEAN.** No defect found.

1. **Every sync duty is healthy**: `drive.watch` 272 runs, `office.sync` 48,
   `office.notion_sync` 24 — all complete, no failures in two days.
   `office.notion_sync` has recovered from the provenance-order defect that
   made it twelve of the office's sixteen failures in a day.
2. **The apparent staleness was my own misreading.** Every connector on every
   live project shows `fetched_at` 6–16 days old, which reads as knowledge
   nobody has refreshed. The code is explicit: it computes a fingerprint every
   pass and writes **only on change** — *"Deliberately not even a touched-at
   bump: a write per source per ten minutes is 144 writes/day/source that say
   nothing."* The office re-reads hourly; the material has not changed.
3. **The misleading column name is inert.** `fetched_at` means *last changed*,
   and `app.project_knowledge` reports it as data beside a separate
   `last_synced`. `coverageOf` — #257's reader, the one that decides what the
   office may say about its own coverage — takes only `blank`, `complete` and
   `documents`. Nothing judges staleness from it.
4. **The positive control passes.** The sync has genuinely found things:
   *"1 new project, 33 new sources across 4 notebooks"* on 11 September and
   *"12 new sources added"* on the 9th. So *"Looked through 4 notebooks.
   Nothing new."* — 296 times — is earned rather than blind.
5. **Concurrency is handled**: *"A sync was already running, so this one stood
   down."*
6. `drive.watch` runs every ten minutes against three attachments on no live
   project and says so honestly; `check:chatter` confirms it does not message
   him.

One of the six checks was wrong before the product was, which remains the
commonest event in this programme.

No code change, so nothing to deploy.

Clean-pass count after pass 25: **1 of 5.**

## Pass 26 — a regression sweep, NOT counted toward the streak

**No defect found — and deliberately not counted.** The brief asks for
*materially fresh behavioural territories*, and this is a sweep over ground
already covered. Counting it would be padding the number, which is the one
thing the stopping criteria must not allow.

It is recorded because thirteen fixes went in this session and something had
to check them.

**What `--report` actually measures, corrected before relying on it.** It
scores turns already RECORDED, so a green 340/340 says nothing about current
code. Two sessions were therefore re-run with `--reset`, chosen because they
cover what this session changed:

- **`d302-dictated`** — dictated speech with a mid-message withdrawal, which
  is pass 11's `taskTitle` retraction seam. **3/3 on fresh turns.**
- **`again-after-stopping`** — *"#315: it must actually stop, and say what it
  stopped"* and *"a cancelled obligation frees its key"*, which is the retry
  grounding work of passes 10 and 11. **3/3 on fresh turns.**

The whole corpus holds at **340/340 across 113 turns**.

**The reruns left debris and the witness caught it**: a task on Grant's
personal list, *"Summarize supplier info for Grant"*, written by a harness job
whose suite does not tear down — `check:leaks` named it and 0530 already
records the gap. Removed; both `check:leaks` and `check:chatter` green.

Clean-pass count after pass 26: **1 of 5** (unchanged, by design).

Filed on the way past, not fixed:
[#338](https://github.com/granterogers/agentic.team.grant/issues/338) —
`vault-export`'s wrong-passphrase check fails about one full run in three and
passes alone every time. #226's shape, on a SECURITY assertion.

## Pass 27 — the feedback loop, and a claim the product could not honour

**Territory:** the thumbs up / thumbs down buttons on Telegram and Slack (#59)
— the mechanism by which the office is meant to learn whether an answer was
any good. Chosen because Telegram is the surface Grant uses most.

**Classification: SYSTEMIC PRODUCT DEFECT.**

**What is canonically true.** Every Telegram message carries 👍/👎 as the
DEFAULT keyboard (`src/telegram/transport.ts:177`), and Slack maps `:+1:` and
`:-1:` to the same two actions (`src/slack/events.ts:103`). A press does three
things: it writes `public.feedback`, it moves `notification_events` past
`delivered`, and — on Telegram only — a 👎 replies *"What should I have done
instead? … I will take it as an instruction, not just a note."*

Only the third does anything.

- `public.feedback` has **no reader at all**: no TypeScript outside the insert,
  no `app.*` function, no view, no operator command. Seven rows, every one
  `positive`, none since 6 September.
- `notification_events` has exactly **one** reader, `app.notification_patterns`,
  and that function has **no caller**.
- `askForTheCorrection` returns early unless `origin_channel === 'telegram'`, so
  on Slack both signals do nothing whatever.

And `app.hq_studio_settings` told him so on both Connections cards — Slack:
*"Reacting with a thumbs up or down is read as feedback."* Telegram: *"A thumbs
up or down on any reply teaches the office something."* The first is entirely
untrue on the surface it describes; the second is half true.

**Fixed:** 0580 (Slack) and 0581 (Telegram) replace both sentences with what is
true and what he can do instead, each with a drive block that raises if the
false claim survives or the honest one is not served.

**Not fixed, deliberately, and filed as
[#353](https://github.com/granterogers/agentic.team.grant/issues/353):** no
consumer was built.
`public.feedback` holds seven rows of one signal and none in seventeen days;
building learning over it is the `public.contacts` trap this file already
records. What a reaction should DO is a product decision, made once rather than
guessed at here.

**Systemic fix — `npm run check:consumed`, in the gate.** `check:callers` walks
FUNCTIONS, `check:pressable` GATEWAY ACTIONS, `check:capabilities` HANDLER
KINDS. Nothing walked TABLES, and 0274 had already named the shape about
`failure_signatures`: *"the mechanism built and the mouth forgotten, which is
#72's shape and which this repository keeps producing."* 122 tables, 2 written
and never read, each with a reason. Proved red-then-green on real exit codes.

**The instrument was wrong five times before the product was wrong once** —
which is the reusable part of this pass:

1. I grepped for a guessed noun (`buttonsFor`), found nothing, and nearly
   reported that the buttons were never attached. They are.
2. Reading the effect rather than the table nearly made me withdraw the finding
   entirely — `resolveNotification` looked like a working consumer until its
   only reader turned out to have no caller.
3. The sweep missed VIEW definitions: `notebook_budgets` and
   `notebook_capability_probes` both looked dead and neither is.
4. It missed OPERATOR COMMANDS: `preference_instructions` is an audit ledger
   `npm run levels` reads.
5. It missed **PostgREST** reads — `slack_workspaces`, 55 rows with an edge
   function reading it on every Slack event, was reported as never read because
   `/rest/v1/<table>` names no FROM and no JOIN.

**A false baselined reason, the third this programme has found.**
`app.notification_patterns`' entry claimed *"npm run levels and the learning
page answer the question a person actually asks"*. Neither names it: checked by
grepping `scripts/` and by asking `pg_proc` for any function mentioning it —
the only row returned is the function itself. Corrected in place.

**Found on the way, and not mine to celebrate:** `npm run lint` had been **red
on this branch** since an earlier pass of this programme — three
`noTemplateCurlyInString` errors in `scripts/shadow/sabotage.ts` and
`tests/jobs/one-clock.test.ts`, all three legitimate uses, now suppressed with
reasons. A commit went out with lint red, which is the trap CLAUDE.md records,
for the third time. Green now.

**#326 hit and worked around.** `npm run migrate` refused to run: the sibling
session on `claude/basecamp-team-hq` had applied 0577, 0578 and 0579 to the
shared database. Copied in from `de5a448` rather than renamed — renaming would
make the repository claim a number it did not run under. Mine renumbered
0578 → 0580. Their four `public.sign_in_*` functions then entered
`check:callers`, and each is baselined naming the branch it belongs to and
whether a caller was verified there (three yes, `sign_in_sweep` no).

**Gates:** lint, typecheck, test (188 files / 3,027 tests), check:migrations,
check:secrets, check:templates, check:callers, check:consumed — all green.

Clean-pass count after pass 27: **0 of 5** — reset by a systemic product defect.

## Pass 28 — a suite labelled in the second segment was real traffic

**Territory:** the voice call path, which no earlier pass had touched.

**Classification: SYSTEMIC PRODUCT DEFECT — containment.** Filed as
[#354](https://github.com/granterogers/agentic.team.grant/issues/354), fixed in
0582, escapes acknowledged in 0583.

**How it surfaced.** Measuring voice traffic before reading any code: 50
non-harness jobs, all `voice:grant`, and the ten most recent all saying *"what
projects have we got"* — which is a suite, not a man. Their dedupe keys were
`voice:turn:verify-basecamp-live-<ts>.<id>`.

**The defect.** 0574 — mine, three passes ago — taught `app.harness_job` to read
the inbound command's dedupe key and wrote its own test for it:
`split_part(c.dedupe_key, ':', 1) = 'verify'`. That reads the FIRST segment. A
voice turn's key is `<channel>:turn:<who>`, so the label sits in the third.

**What it cost.** 14 jobs, 8 → 23 September, every one reading as Grant's own
voice note to every witness the office has, **answered and delivered**: 20
messages reached a real destination — `telegram 1386648496`, his chat, and real
Slack channels — after 0523 was supposed to make that structurally impossible.

**The shape that made it invisible, and the part worth keeping.** `check:leaks`
reported `new escapes since containment fix: 0` throughout, because the guard
(`app.claim_delivery`) and its witness (`check:leaks`) **both ask
`app.harness_job`**. They agreed with each other and were both wrong. A witness
that inherits the blind spot of the thing it watches cannot report it — which is
a worse failure than either half being broken alone.

The other signals were not wrong, which is why none of them helped:
`jobs.is_fixture` is GENERATED from `requested_by`, and `enqueue_inbound`
composes that as `<origin_channel>:<subject>` — the subject is "grant".
`jobs.synthetic` is false and **correct**: the traffic genuinely came through the
production door, because a suite calling the real voice webhook *is* a
production request. The label in the dedupe key was the only discriminator.

**The fix is to stop having two vocabularies.** `app.harness_label` already
existed and already anchored on both `^verify-` and `:verify-`, for exactly this
reason; 0574 wrote a second, narrower test beside it instead of calling it. 0582
deletes the bespoke test and calls the shared predicate.

**The expensive direction, and the control for it.** `app.harness_job` EXCLUDES
rows from the readers Grant looks at, so a predicate that is too generous
**hides his real work** — the opposite of 0304's asymmetry. Both migrations
assert in both directions, and the guard was driven on a real escaping job
inside a rollback: `state=suppressed`, while a genuinely real job still returns
`claimed`. Both drives left nothing behind.

**Escapes acknowledged, not hidden.** The 20 went into `public.known_escapes`
against #354 with the reason. `public.deliveries` is untouched, the two
preserved #298 rows are untouched, and 0583's own control refuses to pass if the
known count ever FALLS — because the one outcome this must never produce is
evidence removed rather than recorded. The witness now says *22 known, 0 new*
rather than staying red by design, which is how a gate teaches people to skip it.

**Permanent regression:** `check:leaks` now asserts the two predicates AGREE — a
command carrying a harness label may not belong to a job that reads as real.
Two independent statements of one fact, so a disagreement means something, and
unlike a count it survives the next suite. **Proved by substituting 0574's exact
predicate back in:** 39 jobs, red, naming a real escaping key; green on restore.
The first attempt at that sabotage did not apply — two occurrences, assertion
refused — and `exit=0` meant nothing until the proof line caught it.

**A note on provenance.** The escaping traffic is the concurrent session's
`verify-basecamp-live` suite on `claude/basecamp-team-hq`. The detector gap is
this branch's, and `app.claim_delivery` suppresses rather than raises, so the
fix cannot fail their jobs — their messages simply stop reaching Grant.

**Gates:** lint, typecheck, test, check:migrations, check:secrets,
check:templates, check:callers, check:consumed, check:leaks — all green.

Clean-pass count after pass 28: **0 of 5** — reset by a systemic product defect.

## Pass 29 — a duty that told him the same thing every hour

**Territory:** what actually reaches his phone. Chosen by measuring deliveries
per kind rather than by picking a feature, which is what surfaced it.

**Classification: SYSTEMIC PRODUCT DEFECT.** Filed as
[#355](https://github.com/granterogers/agentic.team.grant/issues/355), fixed in
0584 + 0585 and the worker seam, deployed.

**What he received.** His Google refresh token was revoked on 15 September.
Every hour after that `google.read_mail` and `google.read_calendar` each failed
and each told him so: 65 Telegram + 65 Slack + 64 Slack = **194 deliveries over
four days, with ONE distinct body between them.** The connection was restored
around the 19th and both duties have run silently since — so the incident is
over and the defect is not, because the message itself says the OAuth app is in
testing mode where refresh tokens expire every seven days.

**The same shape, hiding better.** `office.notion_sync`: 137 sends, **128
distinct bodies**, saying one unchanged fact every two hours — the page count
was 60 for 72 consecutive runs, then 57 for 51. A model rewords it each time, so
it reads as news and **a text-based witness cannot see it at all**. Its
`announce` is correct about changes and fires on `skipped.length > 0`, where the
skipped set is four permanently-empty Notion sections.

**Why nothing caught it, and this is the part worth keeping.**
`check:chatter`'s ceiling is 100/day per kind and this peaked near 36.
`app.recurring_failures` and `app.notice`'s `failure_repeats` branch both read
**failed** jobs — and these jobs **completed successfully while reporting a
failure**. A duty that succeeds at saying it failed is invisible to every
failure mechanism the office has.

**The fix**, at the one place `jobs.announce` is written: `app.say_once`. A duty
speaks when what it has to say CHANGES, and at most once a day when it does not
— not never, because he should still be told daily that his mail has been
unreadable for a week. It never turns silence into speech (it runs under
`if (announce)`), never touches conversation (scoped to kinds
`public.responsibilities` schedules, derived rather than listed), and **fails
open**: `?.say !== false`, so an empty row makes the office speak.

**A hole I found in my own fix before it could bite.** 0584 keyed the
fingerprint on KIND alone. `drive.watch` runs per project across 14 projects, so
two projects whose news read identically would have had the second MUTED —
losing real information rather than sparing a repeat, which is the expensive
direction. 0585 keys on (kind, project) with `app.unnamed_project()` as the
sentinel, because a NULL in a key never matches `on conflict`, which is the
`documents_one_per_external_ref` lesson. `duty_said` had never held a row, so
nothing was ever muted by the narrower version.

**Two instrument corrections, both mine, both caught by reading:**

1. I read a `max(created_at)` over ALL runs as the last FAILURE date and said
   `notion_sync` was "still failing today". Every one of its 30 failures is from
   18 September, the day it was fixed. Corrected before building on it — and
   then I did the same thing again with the 194 messages, calling them ongoing
   when they stopped on the 18th. Twice in one pass.
2. 0585's drive block failed on `no subject to drive with` because I pointed the
   cross-project control at `notion_sync`, which covers every project in one run
   and carries no `project_id`. The subject was wrong, not the fix.

**Sabotage:** disabling the seam turned the wired-call test red; restoring it
green. Honest limitation — **one half of that sabotage did not apply** (a
template-literal replacement matched nothing) and the proof line reported
`0 occurrences`, which is the only reason I knew.

**Verified deployed:** worker deployed clean. End-to-end confirmation of the
mute is pending the next scheduled `office.notion_sync`; the mechanism itself is
driven against real rows in both migrations.

**Gates:** lint, typecheck, test (189 files / 3,030 tests), check:migrations,
check:secrets, check:templates, check:callers, check:consumed, check:leaks,
check:chatter — all green.

Clean-pass count after pass 29: **0 of 5** — reset by a systemic product defect.

## Pass 30 — his activity panel was mostly test traffic

**Territory:** the dashboard surfaces, reached by asking what `tasks.remind`
does with 379 runs. It turned out to be correct, and the panel it writes into
was not.

**Classification: SYSTEMIC PRODUCT DEFECT.** Filed as
[#356](https://github.com/granterogers/agentic.team.grant/issues/356), fixed in
0586 and 0587, witness added to `check:leaks`.

**The finding.** `app.hq_studio_lately` answers the studio's *"what has the
office been doing"* panel. Asked for 200 it returned **125 items, 73 of them
suites** — `verify:pursues changed a autonomy` eight times,
`verify-sess-pref-override learned something` three — with **6 in the top 20**,
which is the only part anyone reads. After the fix: 55 items, 0 harness, still
populated.

**Both halves of one function, and only one wrong.** Its counters already asked
`not app.harness_job(...)`; the FEED filtered `p.project_id is null or not
p.is_fixture`, which excludes a fixture PROJECT and says nothing about who
acted — and #45 sends any suite testing a fixture filter to a REAL project, so
those events walk straight through. The numbers above the list were clean and
the list was not. Fifth instance of that shape in this file.

**Why nothing caught it.** `check:leaks` has a *"harness traffic on a table
Grant reads"* check and it passed throughout, because it did not know this
reader existed. It counts this surface now, proved by pointing it at
`public.events` the way the feed used to look: **red at 99 suite rows, green on
restore.**

**A defect the fix uncovered, which is the part worth keeping.** With the suites
filtered out his own rows could be read properly, and `app.action_in_words`
composes the article as a bare `'a ' || noun` — so a vowel noun reads
**"changed a autonomy"**. Exactly one noun does today and it is not a rare one:
`autonomy.changed` has 441 events and #15 made that dial something he sets. It
was invisible only because the vowel rows all belonged to `verify:pursues`.
0587 fixes it by SOUND rather than by listing nouns, with the control that
`office`, `ledger` and `system` still take no article.

**Cleared, not fixed:** `tasks.remind` runs 379 times in 14 days and has
announced nothing — correctly. All three of his open tasks carry no due date, so
nothing can be due. Recorded so nobody re-investigates it.

**A trap paid for again:** backticks inside a comment inside a template literal,
in `check-leaks.ts` — two passes after writing that lesson into CLAUDE.md. It
announces itself as an esbuild parse error pointing somewhere else.

**Gates:** lint, typecheck, test, check:migrations, check:secrets,
check:templates, check:callers, check:consumed, check:leaks — all green.

Clean-pass count after pass 30: **0 of 5** — reset by a systemic product defect.

## Pass 31 — a suite's control rows in his morning briefing

**Territory:** the morning briefing, what he reads daily.

**Classification: one HARNESS DEFECT and two LOCAL PRODUCT DEFECTS.** Filed as
[#357](https://github.com/granterogers/agentic.team.grant/issues/357), fixed in
0588 and in `scripts/verify/notice.ts`. Recorded at that size rather than
inflated — none of the three is systemic.

**What his briefing said**, verbatim from `public.outputs` at 09-23 04:00:
*"noticeproof.mu6wxsku and noticeproof.mu6ww50g have each failed three times
since 18 Sep."* Those are `verify:notice`'s positive-control rows, and they are
**correct by design**: #45 means the control must carry a REAL job id or the
reader it tests would filter it and prove nothing. For as long as they exist
they are indistinguishable from one of his own failures.

**1. A sweep at the end cannot protect a surface that reads continuously.** The
suite already swept on crash, and its own comment records a row having been
swept out of his briefing once before. A sweep only NARROWS the window; the
04:00 duty fired inside it. Now written and asserted inside one transaction that
never commits — `recurring_failures` sees its own transaction's writes, so the
control is exactly as strong and the window is zero. 36/36, and it asserts it
left nothing behind.

**2. `recurring_failures` treated "cannot check" as "real".**
`where (f.last_job_id is null or not app.harness_job(...))` — the `is null`
branch reports a signature nobody can attribute as his. 0304's asymmetry with
the sign reversed, and `app.failure_seen` has the identical hole on the writing
side, so such a row is neither refused going in nor filtered coming out. Driven
inside a rollback BEFORE the fix was written.

**3. The briefing counts with the weak predicate.**
`app.morning_briefing_facts` uses `not j.is_fixture` where the canonical one is
`app.harness_job` — 0355's rule, and a fourth reader nobody carried it across
to. Peak overcount over ten days: 11 of 373, about 3%.

**Checked and cleared:** *"54 items are waiting on you"* looked like a
regression of the fixed `needs_me` defect and is not — the view returns 4 now.
The 50 were a suite's blockers, live at 04:00 and torn down since: the same
window as finding 1, on a different table.

**Also cleared this pass:** `office.notion_sync`'s 30 failures are all from 18
September, the day it was fixed, and nothing has failed anywhere in five days.
I misread a `max(created_at)` over all runs as a last-failure date and said it
was still failing today — corrected before it went anywhere.

**Gates:** lint, typecheck, test, check:migrations, check:secrets,
check:templates, check:callers, check:consumed, check:leaks, verify:notice
(36/36) — all green.

Clean-pass count after pass 31: **0 of 5** — a harness defect that reached a
real surface is a meaningful finding, so it does not count as clean.

## Pass 32 — the knowledge path: CLEAN

**Territory:** indexing and retrieval — whether a source Grant attaches becomes
something the office can actually find, and whether an empty search is honest.
Materially different from passes 27–31, which were all about what reaches him.

**Classification: NO DEFECT FOUND.** Nothing was fixed and nothing was filed.

**What was checked, all against canonical rows:**

1. **Attachments produce documents.** notebooklm 4/4, notion 3/3. The one
    `upload` attachment with no documents is the catch-all *"Direct messages and
    uploads"* bucket on `Unnamed` — empty because nothing has been uploaded
    there, not a gap.
2. **Everything is indexed.** 93 documents across four active projects, every
    one with a populated `search` vector.
3. **Retrieval returns real material.** "transformative wellness" → 6,
    "Q2 planning" → 2.
4. **Negative control.** "banana submarine" → 0, and "hypertrophy" → 0 in a
    project that does not hold it.
5. **Project scope holds.** Every hit returned under a project filter belongs to
    that project.
6. **Mirrors do not double-count.** 0 rows carrying `mirrors_document_id`
    returned beside their originals, which is 0169's rule still working.
7. **#257's coverage note is right in both directions.** A fully-indexed
    project reports `complete: true, blank: []`; the project with the unindexed
    upload reports `complete: false, blank: ["upload"]`. The office can tell
    "there is nothing" from "there is a source I cannot see into".

**Two of my own hypotheses were wrong, and both were disproved by looking at
rows rather than counts** — which is the reusable part of a clean pass:

- **The briefing's "Hypertrophy" reference looked fabricated.** It appears in no
   document and no open blocker keyed the way I first searched. It is real:
   Grant said it himself (`inbound_commands.instruction`) and there is a
   still-open blocker from 9 September asking him to confirm the entry's scope.
   The briefing was correct. Searching the wrong columns nearly produced a
   fabrication report about an accurate sentence.
- **Scope isolation looked broken** — a phrase from project A returned 5 hits
   under project B. Every one of those hits IS in project B: full-text search
   matches individual terms, and "transformative" and "wellness" occur there.
   The count looked like a leak and the rows showed a correct filter.

**Gates:** not re-run; nothing changed.

Clean-pass count after pass 32: **1 of 5.**

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
