/**
 * Run every verification suite this repository has, and say honestly what
 * happened to each one.
 *
 *   npm run e2e -- --limit 8            # run the next eight not yet attempted
 *   npm run e2e -- --only ui,talk,hq    # run these, again, whatever their state
 *   npm run e2e -- --report             # write the markdown from what is recorded
 *   npm run e2e -- --reset              # forget every result and start over
 *
 * ## Why this exists
 *
 * Issue #41. Grant asked for *"a complete end to end systems test as deep and
 * as detailed as possible"* — and the repository already had seventy-nine
 * `verify:*` suites and **no way to run them all**. `verify:all` runs three.
 * So the state of the whole stack was a thing nobody could ask for: you could
 * run any one suite, and nobody had ever run every one in a single pass.
 *
 * That is the same shape as the trap in CLAUDE.md about an audit that never
 * opens a surface. A suite that exists and is never run is a suite that is
 * green by assumption.
 *
 * ## Resumable, because a full pass does not fit in one sitting
 *
 * Seventy-nine suites, several of which drive a real browser at three device
 * sizes, is well over an hour of wall clock. Results are appended to
 * `.out/e2e-results.json` as each finishes, so a pass can be built up in
 * batches and nothing is lost when one batch is interrupted.
 *
 * ## What a result means
 *
 *   pass       exit 0
 *   fail       exit non-zero — the suite ran and said no
 *   timeout    still running after its budget; recorded, never silently retried
 *   error      could not be started at all
 *
 * **"Could not be tested" is a real result**, and #41 says so explicitly: an
 * unrunnable check is exactly where the next CORS bug will live. So a timeout
 * or an error is never rounded down to a skip, and the report prints them in
 * their own section rather than folding them into the failures.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'

const RESULTS = '.out/e2e-results.json'

/**
 * Every result ever recorded, one JSON object per line, never overwritten.
 *
 * Issue #226. `RESULTS` above holds ONE result per suite and the next run
 * replaces it, which is fine for "what is the state now" and useless for the
 * question that actually caught a defect on 14 September: *has this suite ever
 * disagreed with itself?*
 *
 * `verify:agents` reported 56/56 on 11 September and 55/56 on 14 September
 * against identical code, because a tiebreak was a random uuid (0361). It had
 * been flaky for at least three days, and the only reason anyone found out is
 * that the same suite happened to run twice against the same commit and
 * somebody happened to compare. Nothing in the repository was keeping the
 * evidence.
 *
 * CLAUDE.md already says a suite that has never been run is not evidence. This
 * is the next sentence: a suite that has been run ONCE is barely more.
 *
 * Keyed by COMMIT, which is the whole design. Two different verdicts against
 * the same commit is a flake. Two different verdicts across a change is just a
 * change, and treating those alike would report every fix as flakiness and
 * every regression as flakiness too.
 */
const HISTORY = '.out/e2e-history.jsonl'

/** The commit under test. Unknown rather than guessed when git cannot say. */
const commit = await new Promise<string>((resolve) => {
  const child = spawn('git', ['rev-parse', '--short', 'HEAD'], {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  let out = ''
  child.stdout.on('data', (b: Buffer) => {
    out += b.toString()
  })
  child.on('close', () => resolve(out.trim() === '' ? 'unknown' : out.trim()))
  child.on('error', () => resolve('unknown'))
})

type Seen = { suite: string; status: string; tally: string; ms: number; at: string; commit: string }

const remember = async (r: Result): Promise<void> => {
  await mkdir('.out', { recursive: true })
  const line: Seen = {
    suite: r.suite,
    status: r.status,
    tally: r.tally,
    ms: r.ms,
    at: r.at,
    commit,
  }
  await appendFile(HISTORY, `${JSON.stringify(line)}\n`)
}

/**
 * Suites that have given more than one verdict for the same commit.
 *
 * Not "more than one verdict ever" — that is a fix, or a regression, and both
 * are supposed to happen.
 */
const flaky = async (): Promise<
  Array<{ suite: string; commit: string; verdicts: string[]; runs: number }>
> => {
  if (!existsSync(HISTORY)) return []
  const seen = new Map<string, { statuses: Map<string, number>; suite: string; commit: string }>()
  for (const raw of (await readFile(HISTORY, 'utf8')).split('\n')) {
    if (raw.trim() === '') continue
    let row: Seen
    try {
      row = JSON.parse(raw) as Seen
    } catch {
      continue
    }
    if (row.commit === 'unknown') continue
    const key = `${row.suite}@${row.commit}`
    const at = seen.get(key) ?? { statuses: new Map(), suite: row.suite, commit: row.commit }
    at.statuses.set(row.status, (at.statuses.get(row.status) ?? 0) + 1)
    seen.set(key, at)
  }
  return [...seen.values()]
    .filter((v) => v.statuses.size > 1)
    .map((v) => ({
      suite: v.suite,
      commit: v.commit,
      verdicts: [...v.statuses.entries()].map(([k, n]) => `${k} x${String(n)}`),
      runs: [...v.statuses.values()].reduce((a, b) => a + b, 0),
    }))
    .sort((a, b) => a.suite.localeCompare(b.suite))
}

/**
 * Per-suite budget.
 *
 * Twenty-five minutes. `verify:controls:studio` presses 217 controls across
 * eight routes at two sizes since #180's resolution fix — it was pressing 97
 * before, and the first budget here was set against that. A budget calibrated
 * on a broken suite times out the fixed one, twice: nine minutes, then fifteen.
 */
const BUDGET_MS = 25 * 60 * 1000

/**
 * Suites this runner will not start, and why — stated here rather than by
 * being quietly absent from the list.
 *
 * `all` is a wrapper around three others and would double-count them.
 * `restore` restores a backup over the live database; it is run deliberately,
 * by a person, not as one of seventy-nine.
 */
const NEVER: Record<string, string> = {
  all: 'a wrapper around verify, audit:credentials and verify:db — would double-count',
  restore:
    'restores a backup over the live database. Run deliberately by a person, never as one of a batch',
  'github-token': 'spends a real GitHub API budget against a token flagged for rotation (#18)',
  'google-live':
    "spends a real Google API quota against Grant's own account. Read-only, but run deliberately rather than as one of ninety",
  db: 'a chain of 46 other suites, every one of which this runner already runs individually — and it ends in `purge:fixtures --go` and `slack:tidy --go`, which are sweeps rather than checks',
  controls:
    'the umbrella over controls:studio, controls:team and controls:settings, which are run individually — together they are ~35 minutes and running both forms doubles it',
}

/**
 * THE FAST READINESS GATE.
 *
 * Grant's backend acceptance specification (2026-09-14) asks for two levels,
 * and only one of them existed. `npm run e2e` is the DEEP ACCEPTANCE SWEEP:
 * ninety-odd suites, ninety-plus minutes, run deliberately. There was nothing
 * short enough to run routinely.
 *
 * `verify:all` looks like the missing thing and is not. It is
 * `verify` + `audit:credentials` + `verify:db`, and `verify:db` is a
 * FORTY-SEVEN command chain that ends in `purge:fixtures --go` and
 * `slack:tidy --go` — destructive sweeps, not checks. Nobody runs that
 * routinely and nobody should.
 *
 * So this is the curated list, and every entry is here for a stated reason.
 * The specification names what a fast gate must cover: highest-value backend
 * paths, severe regressions, persistence, isolation, routing and delegation,
 * capability honesty, task and project operations, critical cheap
 * integrations, and fixture cleanup. One or two suites per area, chosen for
 * the ratio of what they would catch to what they cost.
 *
 * NOT in it, deliberately: anything driving a browser (that is the UX QA
 * standard's job, and `verify:controls:studio` alone is sixteen minutes),
 * anything spending a real external budget, and anything whose failure would
 * be a known-open Issue rather than a new regression.
 *
 * Keep the FAST part under about six minutes. The last entries (the isolated replica and the live acceptance suites) are
 * the audit's own evidence and take about an hour; `--only` runs any of them alone. A gate that takes fifteen minutes is a gate that
 * gets skipped, and a skipped gate is worse than no gate because the
 * repository still believes it has one.
 */
/** Must pass before anything after them runs (#381). */
export const PREFLIGHT: readonly string[] = ['check:door-origins', 'check:voice-sessions']

const GATE: ReadonlyArray<readonly [script: string, why: string]> = [
  /*
    PREFLIGHT, FIRST (#381). Static checks that can recognise an unsafe test
    origin run before ANY suite able to knock on a production door, and a
    failure stops the gate: running the suites after them would be finding out
    by sending. They were listed after the live-door suites until the 29
    September acceptance noticed.
  */
  [
    'check:door-origins',
    'no script drives a real Telegram, Slack, MCP or dashboard door without declaring its conversation first (#381)',
  ],
  [
    'check:voice-sessions',
    'no script reaches the live voice door under a name the guard reads as Grant',
  ],
  // Persistence and the shapes a client actually reaches.
  ['verify:schema', "the schema's own dangling references"],
  /*
    The instrument, before anything it measures.

    `npm run replay` reports better/worse/unchanged against real history, and
    every one of those verdicts is worth exactly what the judge making it is
    worth. This repository has already shipped a version whose judge could not
    detect a deliberately sabotaged run, and the only reason anybody found out
    was running the control. Five pairs with a known direction, both ways
    round, about a minute: cheap enough to keep, and the alternative is a
    measurement that decays silently.
  */
  ['verify:judge', 'the comparative judge can still tell a good answer from a bad one (#133)'],
  /*
    The one criterion #257 is actually about.

    Grant asked about a document in a linked Google Notebook and was told it
    could not be found; only naming the connector retrieved it. This asks the
    same question without naming it, end to end from the inbound command
    through the real handler to the answer, and asserts the office knows what
    only that document says. Everything else in this Issue is a mechanism; this
    is the behaviour.
  */
  ['verify:unified', 'a linked source is findable without being named (#257)'],
  /*
    The whole chain for one request, on evidence rather than on prose.

    #258's failure mode is a confident sentence with no file behind it, so this
    reads the bytes back out of Storage and checks the PDF header — and its
    negative control asserts that a project with nothing in it produces NO
    file, which is the half a happy-path suite would call a pass.
  */
  ['verify:artifact', 'a request for a PDF produces a real, stored, linkable PDF (#258)'],
  /*
    Stopping work that is running.

    `stop_job` existed at the gateway and nothing had ever pressed it, so a job
    spending tokens on the wrong thing could only be waited out. The suite
    covers the whole dimension — including that a step in flight finishes and
    the work already done survives, because a stop that discarded a finished
    step would make the button too expensive to press.
  */
  ['verify:stop', 'a running job can be stopped, and keeps what it already finished (#41)'],
  ['verify:review', 'Grant can let a made document into the project, or keep it out (#28)'],
  ['verify:proposes', 'what the office could not do becomes something Grant can answer (#49)'],
  ['verify:connectors', 'an outside provider can be added, offered and disconnected (#265)'],
  ['verify:organising', 'tags and collections are Grant’s to set, not only an agent’s (#276)'],
  ['verify:recovery', 'archiving, disconnecting and signing in all have a way back (#276)'],
  /*
    The one claim #258 refused to make from unit tests: a real question in a
    real Slack channel, and the link that arrives FETCHED. It found that
    `storagePath` never reached the message — so every artifact ever produced
    took the honest-degradation branch — and that one request made two reports.
  */
  [
    'verify:artifact-slack',
    'a generated PDF reaches a real Slack channel as a link that works (#258)',
  ],
  /*
    And the boundary that keeps Grant's own list his (#259). One table holds
    both kinds of task, and ADR-0041 names the failure as asymmetric: a missing
    personal task is an annoyance, the office's work in his personal list is
    what stops him trusting it. Every reader is asserted in both directions.
  */
  ['verify:mytasks', 'my tasks are mine, and the team’s work is not in them (#259)'],
  /*
    The index itself, and the correspondence beside it.

    Both were outside the gate while carrying the rules that decide what
    reaches a model: which documents retrieval returns and which it hides
    (0464, ADR-0040), how an upstream deletion reconciles (0465, 0466), and
    which of Grant's mail a project may see at all (ADR-0037). CLAUDE.md's own
    entry is that a suite outside the gates for a change is a suite that will
    be red and unnoticed — `verify:arrangement` sat broken for a morning
    exactly that way.
  */
  ['verify:knowledge', 'one document one hit, archived out of search, deletions reconcile (#257)'],
  ['verify:mail', 'a project sees only its own correspondence, and what has gone quiet (#172)'],
  [
    'verify:wrappers',
    'every RPC a client calls is reachable — PostgREST exposes only `public`, and a missing wrapper is invisible until called',
  ],
  [
    'verify:transitions',
    'the job state machine in the database and the one in the code still agree',
  ],
  // Capability honesty. The invariant the whole specification is built around.
  ['verify:attests', 'an agent may not say it looked when it did not (#185)'],
  ['verify:knows', 'a false "I can\'t" and a false "I can" are both failures (#64)'],
  // Routing and delegation, which output attribution cannot prove.
  /*
    First of the routing checks deliberately, because it is the only one that
    can run when the model provider cannot (#239) and it takes three seconds.

    It settles the question a confident misroute makes invisible: the ceiling
    was ordering the intersection, so "draft the announcement copy" went to
    growth and "audit the refund policy for compliance risk" went to research
    — plausible specialists, answering confidently, from the wrong desk.
    `verify:routing-breadth` measures how OFTEN the right person is reached
    across phrasings and scored both of those as hits.
  */
  [
    'verify:reach',
    'the vocabulary and the intent ceiling agree on who answers — deterministic, no model (#231)',
  ],
  [
    'verify:routing-breadth',
    'every specialist is reachable by how Grant actually talks, and nothing trivial convenes one (#232)',
  ],
  ['verify:delegation', 'the work is actually delegated, not eight voices and one worker (#65)'],
  [
    'verify:collaborates',
    'a two-subject request reaches a second specialist as real work, and the chain stays bounded (#233)',
  ],
  ['verify:handoff', 'delegation that leaves a trace'],
  /*
    Duplicate execution (#337). He asked the same thing twice three minutes
    apart and got two reports; the guard that stops the second landed on 23
    September and its regression suite was left outside this list — which is
    the shape CLAUDE.md already names, a suite that will be red and unnoticed.
    It spends model calls, like the three entries above it, and it guards one
    of the invariants a person notices immediately.
  */
  [
    'verify:another-go',
    'asking twice starts one piece of work, and saying "give it another go" starts a second (#337)',
  ],
  /*
    What the office does when things go wrong, at the level of the JOB rather
    than the integration. `verify:chaos` proves the rest of the system stays up
    and `verify:failures` proves a failure is classified; neither asserts that
    the person waiting gets a truthful answer.

    Needs no model, which is not a compromise: a recovery property must hold
    for ANY handler outcome, so a stub that fails on demand is a better
    instrument than a real one that fails when the weather does — and this runs
    when the provider is out, which is exactly when somebody wants to know.
  */
  /*
    The 17 September backup died with nothing said (0535).

    `verify:recovers` proves a recovered job does not fabricate, duplicate or
    strand. It says nothing about the job that simply DIES — and six paths
    reach `failed`, of which three used to write no record anywhere a person
    looks. The one that mattered was in SQL, so no amount of care in
    `worker.ts` could have covered it.
  */
  /*
    Invariant 13, both halves, and the reading that could not see either.

    app.office_health() reported failed, stalled, waiting, breakers and budget
    holds and had NO idea whether a backup existed -- so the night the nightly
    backup died it read `failed: 1` for 24 hours in a window nobody watches,
    and then said nothing at all. And backup:rehearse printed a report and
    exited, so "when did a restore last work" had no answer anywhere.
  */
  /*
    The escape that reported green.

    verify:history sent a real Telegram message to Grant's own chat and a real
    Slack message while reporting 51/51, exit 0. 0523's guard asked
    app.harness_job, which was DERIVED from an attribution the suite controls,
    so at send time it said false. 0541 moves the mark onto the door the work
    came through and makes it immutable; 0542 carries it down the lineage.

    Every attempt here runs through the real DeliveryService with a transport
    that counts its own invocations, so "0" is a claim about whether the
    sending code was reached at all -- and a positive control proves a
    permitted delivery still reaches it.
  */
  [
    'verify:escapes',
    'synthetic work cannot cross a real external boundary, proved by attempting it (0541, 0542)',
  ],
  [
    'verify:backups',
    'a recent FINISHED backup and a PROVEN restore, and a chore when either is missing (0537, 0538)',
  ],
  /*
    And the other half of the same night's finding.

    0535 made the backup's death visible. This is why it was dying: a
    checkpointed job that runs out of wall clock is picked up again, and every
    pickup spent one of five attempts. The backup needed one attempt on 16
    September and three on the 21st as the database grew 78k -> 135k rows. Two
    of headroom left, with nothing anywhere watching the margin.
  */
  [
    'verify:resumes',
    'a job that ran out of time resumes without spending a retry, and one that failed still dies (0536)',
  ],
  [
    'verify:journals',
    'a job that dies says so, whichever layer killed it — a silent backup failure cost Grant a day of backups (0535)',
  ],
  [
    'verify:recovers',
    'no fabricated success, no duplicate action, no lost mutation, no stranded work (#231)',
  ],
  [
    'verify:cross-interface',
    'the same instruction through any surface uses the same canonical layer (§22 B)',
  ],
  // Project and task operations — what Grant touches most.
  ['verify:identity', 'a name finds the right project, and an ambiguous one finds nobody'],
  ['verify:tasks', 'the task system, driven rather than described'],
  // Isolation. One project cannot see another.
  ['verify:history', "one conversation, both sides, and nothing from anybody else's project"],
  // Transport honesty — a message Grant sent must not vanish.
  ['verify:transport', 'a message does not disappear because a provider was down'],
  // Permissions and the public surface.
  ['verify:security', 'the public surface, probed as an attacker would'],
  ['verify:dryrun', 'a dry run that writes anything is not a dry run'],
  // Fixture hygiene is part of the test, not a chore after it.
  [
    'verify:drains',
    'the queue is actually moving — a dead worker once left Grant waiting fifteen hours while the heartbeat logged 1,440 successes',
  ],
  ['check:leaks', "no suite left a project, job or channel in Grant's real views"],
  [
    'check:icons',
    'every project-mark default names an icon the page can actually draw (#221 shipped twelve that did not)',
  ],
  [
    'check:branding',
    'no shipped page says "Basecamp": Team HQ is the product\'s name, and the check proves it can fail (#382)',
  ],
  [
    'check:callers',
    'no NEW capability ships with nothing that calls it — #72 had five in one session, each green in its own suite',
  ],
  /*
    And the same question one layer up.

    `check:callers` walks DATABASE functions; a gateway action is a key in an
    object, so it cannot see one. `stop_job` sat unpressed since the browser
    work — the action existed, the function worked, and Grant could not stop a
    running job — and the grep that should have caught it looked fine, because
    an unrelated `data-stop` filled the page with the word.
  */
  [
    'check:pressable',
    'no gateway action ships without a control that presses it — the same defect as #72, one layer up',
  ],
  /*
    And the same question again, in the stylesheet.

    CSS resolves an undefined custom property to nothing and carries on, so a
    mistyped token is invisible to every other check here: not overflow, not
    low contrast, not small type, not a dead control, and a square card is a
    design somebody could have chosen. #124's density commit opened a block
    above the base radius tokens and 44 rules reading `var(--r-card)` computed
    to 0 in the default density, deployed, for a day.
  */
  [
    'check:tokens',
    'every bare var() names a token :root actually declares — #124 shipped square corners for a day',
  ],
  /*
    And the same question about the OFFICE the page talks to.

    Six modules under `web/studio` each fell back to one project's gateway, so
    a dashboard somebody else deployed pointed at an office that was not
    theirs and was refused with a 401 and no explanation (IR-1). `backend.js`
    resolves it once and `npm run config:site` supplies it at deploy time.

    The fallback is tempting to bring back, because a hardcoded address makes a
    local page work. This is what stops it, and it can be asked to prove it can
    fail: `npm run check:backend-ref -- --prove-it`.
  */
  [
    'check:backend-ref',
    'nothing served to a browser names a particular office — a clone must resolve its own (IR-1)',
  ],
  /*
    And the question the whole second half of #282 is about.

    Telegram, Slack and Team HQ are three doors into one office, and §5 says an
    adapter may only TRANSLATE. Tracing every ingress found one path, which is
    why placing the semantic layer in `office.instruction` fixed all of them at
    once — and nothing anywhere was keeping it that way.

    The cheapest way for it to break is somebody adding "just a small regex" to
    one adapter for a shape the office reads badly: local-looking, green in
    every suite, and a second reader of human language in the building. The
    symptom a month later is the same sentence behaving differently depending
    on which door Grant used, which is the hardest class of defect to see.
  */
  [
    'check:one-brain',
    'no door reads what Grant MEANT — one interpreter, or two that will disagree (#282)',
  ],
  /*
    And the same question once more, at the layer where a whole feature hides.

    `check:callers` walks database functions and `check:pressable` walks
    gateway actions. Neither can see a JOB KIND, which is where the browser
    tier went: adapter, ledger, tab, sessions, budget and Stop, all built, all
    passing their own suites, and unreachable from any sentence Grant could
    say because nothing ever created a `browser.gather`.

    That was fixed for that one kind and never asked about the other
    thirty-five. Two more were in the same state on the day this was added.
    `notebook.collect_artifact` is #66 — bring the audio into the project and
    send it to Telegram, in his own words — proved by hand on 11 September and
    then reachable by nothing for eight days, so the live chain ended at a
    link, the one outcome he said he did not want. `mcp.discover` is #265's
    survey, and `register_mcp_provider` was returning "ask it what it offers"
    with nothing able to ask.
  */
  [
    'check:reachable',
    'every registered job kind has something that can start it — #66 and #265 were both unreachable',
  ],
  /*
    And the mirror of that question, which is the one #320 turned up.

    `check:reachable` asks whether a capability can be STARTED — the failure
    where a whole tier exists and no sentence reaches it. This asks whether a
    capability a conversation CAN start is one the agents have been TOLD about,
    because `capabilityBrief` is built from `tool_permissions` and an agent
    reads that brief as the truth about itself.

    `artifact.report` was reachable and unclaimed: 139 PDFs produced, no row
    naming it, so asked to improve one it had just made the office answered
    "I can't create a PDF directly in Telegram" and offered a Notion page to
    export by hand. 0298 made a registry CLAIM checkable and said in its own
    comment what the other direction costs; this is that direction.
  */
  [
    'check:capabilities',
    'every capability a conversation can start is one the agents know they hold — #320 denied a PDF it had made 139 times',
  ],
  /*
    AND EVERY STANDING RULE IS ONE THE OFFICE WOULD STORE TODAY.

    `STANDING` in `teaching.ts` contains the bare word `never`, so *"Okay,
    never mind about that."* was read as a standing instruction and sat in
    every Chief of Staff prompt for eight days at 0.95 confidence. A code fix
    stops the next one and cannot see the one already stored -- and nothing
    was looking: `check:leaks` asks whether HARNESS lessons reach a real
    prompt and had no opinion about whether a REAL one makes sense.
  */
  ['check:standing', 'every standing rule in a real prompt is one the office would accept today'],
  /*
    AND NOTHING IS TALKING AT HIM.

    `office.provision_channels` sent 756 messages to Grant's real Telegram chat
    on 16 and 17 September, 746 of them in one day. 0477 bounded that enqueuer
    and nothing was watching the class: `check:leaks` asks whether HARNESS
    traffic reached a real destination, and `app.office_health()` reports
    failures, stalls and waiting work — a duty that runs perfectly and sends
    perfectly is none of those.
  */
  ['check:chatter', 'no duty is sending Grant more than a hundred messages a day'],
  ['check:undo', 'every reversal the office offers, app.hq_undo can actually perform'],
  [
    'check:believes',
    'no service the office is delivering through is described to its agents as unreachable',
  ],
  ['check:answerable', 'every question open on his dashboard has somewhere for an answer to go'],
  ['check:anon-exposure', 'no function in public can be executed with a public key (#384)'],
  [
    'check:machine-key',
    'the office key reaches no person-defaulting function that is not pinned with a reason (#400)',
  ],
  [
    'check:system-secrets',
    'every human-integration credential is read through the one resolver, and every vault secret has a class (#400)',
  ],
  [
    'check:ownership',
    'every table has an ownership class and a derived table proves its owner (multi-user P0)',
  ],
  /*
    AND NOTHING IS WRITING INTO A VOID.

    `check:callers` walks database FUNCTIONS, `check:pressable` walks GATEWAY
    ACTIONS, `check:capabilities` walks HANDLER KINDS. All three ask whether a
    mechanism that was built is reachable, and nothing asked it about TABLES --
    which 0274 had already named, about `failure_signatures`: "the mechanism
    built and the mouth forgotten, which is #72's shape and which this
    repository keeps producing".

    Pass 27 produced it again. A thumbs up or down on Telegram or Slack writes
    `public.feedback`, which nothing reads, and moves `notification_events`,
    whose only reader has no caller -- while both Settings cards told Grant the
    press was read (0580, 0581).
  */
  ['check:consumed', 'no table the product writes is one nothing can ever read'],
  /*
    AND A RULE HE CANNOT SEE FROM WHERE HE IS STANDING IS STILL ONE IT HOLDS.

    `believed` is scoped to the level the turn is at, so from inside a project
    a global rule was invisible to the withdrawal lookup and the office
    answered *"I do not have a standing rule about that"* about a rule in the
    prompt that composed the sentence. #320's invariant family. The suite also
    asserts the retraction row says who did it and why in the right columns,
    which is the defect 0567 records as permanent in the rows before it.
  */
  [
    'verify:withdraw',
    'the office does not deny holding a rule it holds, and can be told to drop it',
  ],
  ['verify:lastword', 'a turn of his that died still tells him so, on the channel he asked on'],
  /*
    And the same invariant driven through the real handler, live.

    `check:capabilities` asks whether the registry KNOWS about a capability.
    This asks what the office SAYS about one: a restated request must not come
    back as "I can't create a PDF" when the office can, which is the sentence
    Grant was actually given. It carries its own control — the exact sentence
    is put through the detector first and must be caught — because a suite
    whose only capability assertion is "nothing was found" passes against a
    detector that cannot find anything.
  */
  [
    'verify:capability-claims',
    'the office does not deny a capability it holds, driven live (#320)',
  ],
  /*
    A cheap integration through the DEPLOYED gateway, which is where this one
    hid.

    `verify:upload` has asserted since #126 that a file Grant drops records as
    `origin = 'yours'`, and it had been failing on exactly that — 0459 rebuilt
    `record_file_document` for an unrelated rename fix and hardcoded a
    connector, which a trigger then turned into `origin = 'source'`. A file off
    his desktop announced itself as having come from a connector, which is the
    confusion 0414 exists to prevent and 0169 says lets an agent cite its own
    output as a source.

    Nobody knew because the suite is not in this list, the same way
    `verify:capability` was red for a week. It costs about a minute, drives the
    real HTTP path rather than the database, spends no external budget, and
    covers two of the areas the specification names — a critical cheap
    integration, and persistence.
  */
  /*
    The SCREEN, not the office behind it (#259).

    `verify:mytasks` drives every RPC and the gateway; none of that is true of
    the page, and the worst defect of this Issue lived exactly in that gap —
    the editor's reminder field rendered blank on a task that had one, and the
    save read a blank field as "clear it", so opening Details and changing the
    title deleted the reminder. Every RPC involved was correct.
  */
  ['verify:tasks-ui', 'My Tasks pressed in a real browser, on desktop and phone (#259)'],
  ['verify:upload', 'a dropped file, through the deployed gateway, with its provenance intact'],
  /*
    THE ARCHITECTURE AUDIT'S OWN EVIDENCE (final audit reconciliation). The original audit's definition of done (its
    section 46) asks for behavioural proof on the integrated system, in a gate that includes the isolated-replica
    suites. These were outside it: the isolated suites were a manual script, the Run 1-5 live suites were run by hand.
    `verify:isolated` needs the local replica (`sudo scripts/isolated/replica.sh`) and FAILS LOUDLY without one rather
    than being skipped: a gate that quietly drops its strongest suites is the defect it exists to prevent.
  */
  [
    'check:gateway-wrappers',
    'every gateway section and action names a public function a browser can actually reach (#340)',
  ],
  [
    'verify:isolated',
    'every isolated-replica proof, each on a fresh copy of production plus the candidate migrations',
  ],
  ['verify:run1-live', 'Run 1 acceptance through the deployed doors'],
  ['verify:run2-live', 'Run 2 acceptance: authority and approval'],
  ['verify:run3-live', 'Run 3 acceptance: identity and sender authorization'],
  ['verify:run3-effects-live', 'Run 3 acceptance: the effect boundary'],
  ['verify:run4-live', 'Run 4 acceptance: durable origin and lifecycle'],
  [
    'verify:run5-live',
    'Run 5 acceptance: exact question binding, forwarded content, fenced children',
  ],
  [
    'verify:final-audit-live',
    'the original architecture audit, representative guarantees across every category',
  ],
]

type Result = {
  suite: string
  status: 'pass' | 'fail' | 'timeout' | 'error'
  code: number | null
  ms: number
  /** The suite's own tally line, when it prints one. */
  tally: string
  /** Last few lines, for a failure worth reading without re-running. */
  tail: string[]
  at: string
}

/**
 * Strip ANSI colour so a tally lifted from output is comparable text.
 *
 * Built with `RegExp` rather than written as a literal. Biome's
 * `noControlCharactersInRegex` refuses an escape too — not only a typed
 * control character — and it is right to: a literal ESC in a source file is
 * invisible in a diff. Naming it once is clearer than either.
 */
const ESC = String.fromCharCode(27)
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
/*
  A stack trace captured from a failing suite carries the ABSOLUTE path of
  this checkout, and the tail of that trace is written verbatim into
  `docs/testing/readiness-gate.md`. `npm run check:secrets` refuses any
  environment value appearing verbatim in a tracked file, and `$INIT_CWD` is
  one — so a red gate wrote a report that could not be committed, four steps
  from the line that caused it. Scrubbing it here covers every captured line
  rather than the one that happened to be noticed.
*/
const HERE = process.cwd()
const plain = (s: string): string => s.replace(ANSI, '').split(HERE).join('.')

const suites = async (): Promise<string[]> => {
  const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts: Record<string, string>
  }
  return Object.keys(pkg.scripts)
    .filter((k) => k.startsWith('verify:'))
    .map((k) => k.slice('verify:'.length))
    .filter((k) => !(k in NEVER))
    .sort()
}

const load = async (): Promise<Record<string, Result>> => {
  if (!existsSync(RESULTS)) return {}
  try {
    return JSON.parse(await readFile(RESULTS, 'utf8')) as Record<string, Result>
  } catch {
    return {}
  }
}

const save = async (all: Record<string, Result>): Promise<void> => {
  await mkdir('.out', { recursive: true })
  await writeFile(RESULTS, `${JSON.stringify(all, null, 2)}\n`)
}

/*
  A suite's own verdict, in its own words.

  Every suite in this repository ends with a line of one of two shapes — the
  table-style ones print "38/39 checks passed", the narrative ones print
  "52 states, 4 findings". Lifting it verbatim means the report says what the
  suite said, rather than this runner paraphrasing seventy-nine different
  vocabularies into a word of its own.
*/
const tallyOf = (lines: string[]): string => {
  for (const line of [...lines].reverse()) {
    const t = plain(line).trim()
    if (/\d+\s*\/\s*\d+\s+checks passed/.test(t)) return t
    if (/\d+\s+(states|findings|controls|checks|attributes)\b/.test(t) && t.length < 130) return t
    if (/^(passed|clean|no dead controls)/i.test(t)) return t
  }
  return ''
}

const run = (suite: string, script = `verify:${suite}`): Promise<Result> =>
  new Promise((resolve) => {
    const started = Date.now()
    const out: string[] = []
    /*
      Its own process group, so a timeout can kill the whole tree.

      `npm run x` spawns a shell which spawns `tsx`, and `tsx` is what binds
      the port. SIGKILL on the child killed npm and orphaned the server: the
      port stayed bound, and the next three suites in the batch died on
      EADDRINUSE within twenty seconds each and were recorded as FAILURES.

      One timeout silently corrupting every result after it is the worst thing
      a runner of seventy-nine suites can do — the report would have named
      three healthy suites as broken, which is the same class of lie as an
      audit that passes for the wrong reason.
    */
    const child = spawn('npm', ['run', script], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      detached: true,
    })
    const take = (b: Buffer): void => {
      const text = b.toString()
      process.stdout.write(text)
      for (const line of text.split('\n')) if (line.trim() !== '') out.push(line)
      // Unbounded output from a chatty suite is a memory leak in a runner that
      // holds seventy-nine of them.
      if (out.length > 400) out.splice(0, out.length - 400)
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)

    let done = false
    const finish = (status: Result['status'], code: number | null): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({
        suite,
        status,
        code,
        ms: Date.now() - started,
        tally: tallyOf(out),
        tail: out.slice(-14).map((l) => plain(l).trimEnd()),
        at: new Date().toISOString(),
      })
    }
    /*
      Negative pid: the group, not the process. SIGTERM first so a suite gets
      the chance to close its server and its browser, then SIGKILL for whatever
      ignored it. Playwright leaves a Chromium behind on a bare SIGKILL.
    */
    const killTree = (signal: NodeJS.Signals): void => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, signal)
      } catch {
        // Already gone, which is the outcome we wanted.
      }
    }
    const timer = setTimeout(() => {
      killTree('SIGTERM')
      setTimeout(() => {
        killTree('SIGKILL')
        finish('timeout', null)
      }, 4000)
    }, BUDGET_MS)

    child.on('error', () => finish('error', null))
    child.on('close', (code) => finish(code === 0 ? 'pass' : 'fail', code))
  })

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2)
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}

if (argv.includes('--gate')) {
  /*
    The gate always runs fresh. Resuming is right for a ninety-minute sweep
    and wrong for a gate: "already recorded" from an hour ago is not an answer
    to "is it safe to push now". So no load, no resume, no --limit.
  */
  const results: Result[] = []
  console.log(`\nreadiness gate — ${String(GATE.length)} checks\n`)
  for (const [n, [script, why]] of GATE.entries()) {
    const bar = '='.repeat(72)
    console.log(
      `\n${bar}\ngate ${String(n + 1)}/${String(GATE.length)} — ${script}\n  ${why}\n${bar}`,
    )
    const r = await run(script.replace(/^verify:/, ''), script)
    results.push(r)
    await remember(r)
    console.log(
      `\n  -> ${r.status.toUpperCase()} in ${String(Math.round(r.ms / 1000))}s${r.tally === '' ? '' : ` — ${r.tally}`}`,
    )
    if (PREFLIGHT.includes(script) && r.status !== 'pass') {
      console.error(
        `\nSTOP: preflight ${script} did not pass, so no suite that can reach a production door is run.`,
      )
      break
    }
  }

  const bad = results.filter((r) => r.status !== 'pass')
  const total = results.reduce((a, r) => a + r.ms, 0)
  const stamp = new Date().toISOString().slice(0, 10)

  const rows = results.map((r, i) => {
    const why = GATE[i]?.[1] ?? ''
    const mark = r.status === 'pass' ? 'green' : r.status === 'fail' ? 'RED' : 'COULD NOT RUN'
    return `| \`${GATE[i]?.[0] ?? r.suite}\` | ${mark} | ${r.tally === '' ? '—' : r.tally} | ${String(Math.round(r.ms / 1000))}s | ${why} |`
  })

  const doc = [
    '# Fast readiness gate',
    '',
    `Generated by \`npm run gate\` on ${stamp}. Issue #224.`,
    '',
    `**${bad.length === 0 ? 'GREEN' : 'RED'}** — ${String(results.length - bad.length)} of ${String(results.length)} passed in ${String(Math.round(total / 1000))}s.`,
    '',
    'This is the SHORT gate. It is not the deep acceptance sweep, and passing it',
    'is not a claim about the whole backend — `npm run e2e` is that claim. What a',
    'green gate says is narrower and still worth having: no severe regression in',
    'persistence, isolation, routing, delegation, capability honesty, project and',
    'task operations, the public surface, or fixture hygiene.',
    '',
    '| check | verdict | tally | time | why it is in the gate |',
    '|---|---|---|---|---|',
    ...rows,
    '',
  ]
  for (const r of bad) {
    doc.push(
      `## \`${GATE[results.indexOf(r)]?.[0] ?? r.suite}\` — ${r.status}`,
      '',
      '```',
      ...r.tail,
      '```',
      '',
    )
  }
  await mkdir('docs/testing', { recursive: true })
  await writeFile('docs/testing/readiness-gate.md', doc.join('\n'))

  console.log(
    `\ngate — ${String(results.length - bad.length)}/${String(results.length)} passed in ${String(Math.round(total / 1000))}s`,
  )
  for (const [i, r] of results.entries())
    if (r.status !== 'pass')
      console.log(`  ${r.status.toUpperCase().padEnd(8)} ${GATE[i]?.[0] ?? r.suite}  ${r.tally}`)
  console.log('report: docs/testing/readiness-gate.md')
  process.exit(bad.length === 0 ? 0 : 1)
}

const all = await load()

if (argv.includes('--reset')) {
  await save({})
  console.log('e2e: results cleared')
  process.exit(0)
}

const everything = await suites()

if (!argv.includes('--report')) {
  const only = flag('only')
  const wanted =
    only === undefined
      ? everything.filter((s) => all[s] === undefined)
      : only.split(',').map((s) => s.trim())
  const limit = Number(flag('limit') ?? wanted.length)
  const batch = wanted.slice(0, Math.max(limit, 0))

  if (batch.length === 0) {
    console.log(
      `e2e: nothing to run — ${String(Object.keys(all).length)} of ${String(everything.length)} suites already recorded`,
    )
  }
  for (const [n, suite] of batch.entries()) {
    const bar = '='.repeat(72)
    console.log(`\n${bar}\ne2e ${String(n + 1)}/${String(batch.length)} — verify:${suite}\n${bar}`)
    const result = await run(suite)
    all[suite] = result
    await save(all)
    await remember(result)
    console.log(
      `\n  -> ${result.status.toUpperCase()} in ${String(Math.round(result.ms / 1000))}s${
        result.tally === '' ? '' : ` — ${result.tally}`
      }`,
    )
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const recorded = everything.filter((s) => all[s] !== undefined)
const by = (status: Result['status']): Result[] =>
  recorded.map((s) => all[s] as Result).filter((r) => r.status === status)

const passed = by('pass')
const failed = by('fail')
const stuck = [...by('timeout'), ...by('error')]
const notRun = everything.filter((s) => all[s] === undefined)

const seconds = (ms: number): string => `${String(Math.round(ms / 1000))}s`

const lines = [
  '# End-to-end systems test',
  '',
  'Generated by `npm run e2e`. Issue #41.',
  '',
  `- suites in the repository: **${String(everything.length + Object.keys(NEVER).length)}**`,
  `- attempted: **${String(recorded.length)}**`,
  `- passed: **${String(passed.length)}** · failed: **${String(failed.length)}** · could not be run: **${String(stuck.length)}**`,
  `- not yet attempted: **${String(notRun.length)}**`,
  `- wall clock across the pass: **${seconds(recorded.reduce((n, s) => n + (all[s] as Result).ms, 0))}**`,
  '',
  '## What a green pass here does and does not mean',
  '',
  'Every number above is a suite exiting zero. Four things it does **not** say,',
  'each of which cost real time to establish and none of which a pass/fail',
  'table can carry:',
  '',
  '1. **Three suites are order-dependent through the shared job queue.**',
  '   `verify:slack` and `verify:worker` both refuse to start while any job is',
  "   live, because dequeue is global and would hand them somebody else's job",
  '   with no handler for it. Neither cancels the jobs it creates, so in a full',
  "   pass whichever runs second fails on the first one's debris.",
  '   `verify:worker` scored 22/26, then 26/26, then 25/26 on three consecutive',
  '   runs. Green here means the queue happened to be empty. See #184.',
  '2. **`verify:controls:settings` presses 12 controls and skips 87.**',
  '   Zero findings out of twelve presses is not coverage of the settings',
  '   sheet. See #183, which is the same defect on the desktop leg of the',
  '   studio suite.',
  '3. **Sections 4, 5, 6 and 8 of #41 are only partly reached by any suite.**',
  '   Cold starts, a 100MB file, a zero-byte file, two workers leasing the same',
  '   job, a migration applied twice and clock skew have no suite at all.',
  '4. **A suite that has never been run is green by assumption.** Before this',
  '   runner existed there was no way to run all 79, and `verify:all` runs',
  '   three. Nothing here was newly written — it was newly *executed*.',
  '',
  '## Deliberately not run',
  '',
  'Listed rather than absent, because #41 is explicit that an unrunnable check',
  'is where the next defect hides.',
  '',
  '| suite | why |',
  '|---|---|',
  ...Object.entries(NEVER).map(([s, why]) => `| \`verify:${s}\` | ${why} |`),
  '',
]

if (failed.length > 0) {
  lines.push(
    '## Failed',
    '',
    '| suite | verdict | time |',
    '|---|---|---|',
    ...failed.map(
      (r) =>
        `| \`verify:${r.suite}\` | ${r.tally === '' ? `exit ${String(r.code)}` : r.tally} | ${seconds(r.ms)} |`,
    ),
    '',
  )
  for (const r of failed) {
    lines.push(`### \`verify:${r.suite}\``, '', '```', ...r.tail, '```', '')
  }
}

if (stuck.length > 0) {
  lines.push(
    '## Could not be run',
    '',
    '| suite | what happened | time |',
    '|---|---|---|',
    ...stuck.map(
      (r) =>
        `| \`verify:${r.suite}\` | ${
          r.status === 'timeout' ? `still running after ${seconds(BUDGET_MS)}` : 'failed to start'
        } | ${seconds(r.ms)} |`,
    ),
    '',
  )
  for (const r of stuck) {
    lines.push(`### \`verify:${r.suite}\``, '', '```', ...r.tail, '```', '')
  }
}

const wobbly = await flaky()
if (wobbly.length > 0) {
  /*
    Its own section, above Passed, because a flaky suite reads as a passing one
    on the run you happen to look at. #226.
  */
  lines.push(
    '## Flaky — more than one verdict for the SAME commit',
    '',
    'A suite here has disagreed with itself against unchanged code. That is not',
    'a fix and not a regression; it is a result that cannot be trusted in either',
    'direction. `verify:agents` was in exactly this state for three days and',
    'nobody knew, because nothing kept the evidence.',
    '',
    '| suite | commit | verdicts |',
    '|---|---|---|',
    ...wobbly.map((w) => `| \`verify:${w.suite}\` | \`${w.commit}\` | ${w.verdicts.join(', ')} |`),
    '',
  )
}

lines.push(
  '## Passed',
  '',
  '| suite | verdict | time |',
  '|---|---|---|',
  ...passed
    .sort((a, b) => b.ms - a.ms)
    .map(
      (r) =>
        `| \`verify:${r.suite}\` | ${r.tally === '' ? 'exit 0' : r.tally} | ${seconds(r.ms)} |`,
    ),
  '',
)

if (notRun.length > 0) {
  lines.push('## Not yet attempted', '', notRun.map((s) => `\`${s}\``).join(', '), '')
}

await mkdir('docs/testing', { recursive: true })
/*
  The report used to be written to `e2e-2026-09-11.md` — a date baked into the
  filename, so every run after the eleventh overwrote a file whose own name
  said it was from a day it was not. Dated at generation now.
*/
const REPORT = `docs/testing/e2e-${new Date().toISOString().slice(0, 10)}.md`
await writeFile(REPORT, lines.join('\n'))

console.log(
  `\ne2e — ${String(passed.length)} passed, ${String(failed.length)} failed, ${String(stuck.length)} could not run, ${String(notRun.length)} not yet attempted`,
)
for (const w of wobbly)
  console.log(`  FLAKY    verify:${w.suite} @ ${w.commit}  ${w.verdicts.join(', ')}`)
for (const r of failed) console.log(`  FAIL     verify:${r.suite}  ${r.tally}`)
for (const r of stuck) console.log(`  ${r.status.toUpperCase().padEnd(8)} verify:${r.suite}`)
console.log(`report: ${REPORT}`)

/*
  A runner that always exits 0 cannot gate anything, and a caller that trusts
  it is being told a sweep with twelve failures succeeded. `stuck` counts too:
  the specification is explicit that "could not be tested" is never a pass.
*/
process.exit(failed.length + stuck.length === 0 ? 0 : 1)
