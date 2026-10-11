/**
 * TIER (b): the CRITICAL replica gate. `npm run verify:critical`.
 *
 * The small set of proofs whose failure means a person could be harmed, a stranger could read somebody's office, the
 * office could act outward without being asked, or work could be lost without a word. It is chosen deliberately from
 * the passing census (docs/audit/SYSTEM-HEALTH-REPORT-2026-10-07.md), not "everything that happens to pass". What does
 * not belong here: characterisations, UX look-and-feel, feature walkthroughs, one-off migration proofs (those are tier c).
 *
 * To add a proof: ONE line below, `p('<name>', <floor>, '<the invariant it guards>')`, or `via(...)` for a special setup.
 * The runner then gives it a clone of the candidate schema of its own, and a red from it fails the gate. Keep the
 * list small enough to finish inside ten minutes; if it grows, the slowest proof is the one to question.
 */
import { p, via } from './p.ts'
import type { Proof } from './types.ts'

export const CRITICAL: readonly Proof[] = [
  // ---- tenant isolation and office identity --------------------------------------------------------------------------
  via(
    'p2',
    'office-ownership',
    76,
    "Person A, Person B, the Sample, the Test office and System cannot read or write one another's rows (96 attacks)",
  ),
  via(
    'p2',
    'office-ownership-sabotage',
    59,
    'the isolation suite is proven able to FAIL: each way the structure is weakened turns it red, then restored it is green',
    { timeoutS: 420 },
  ),
  via(
    'p3',
    'p3-app-attack',
    1100,
    'every application door (gateway, Telegram, Slack, MCP, voice, upload, workers) is tried as the wrong person (1,421 attacks)',
  ),
  p('p1-operator', 21, 'a second person reaches none of the operator-only actions and sections'),
  p(
    'p1-storage-order',
    15,
    'a storage read or write by an unknown or officeless caller is refused BEFORE any storage call is made',
  ),
  p(
    'p1-credentials',
    26,
    "a credential is read through ONE office-scoped resolver; one office never resolves another's secret",
  ),
  p(
    'layout-isolation',
    13,
    "two people keep separate arrangements for one project, and a writer with the office check removed is shown accepting another person's save (sabotage control)",
  ),
  p(
    'layout-cas',
    17,
    'a saved arrangement is compare-and-swap: a save from a stale revision stores nothing, twelve simultaneous saves have one winner, an empty reset is also guarded (#442)',
  ),
  p(
    'background-storage',
    40,
    "a project's background picture is stored per office through the real gateway: another office reads and writes nothing, hostile image types are refused, the quota holds, and the emulator reached nothing but the replica (#445)",
  ),
  p(
    'principals',
    66,
    'who is a person, a harness, a guest or unknown is decided in one place and unknown is never trusted',
  ),
  p(
    'sender-authorization',
    31,
    "a message from somebody who is not the office's person is not that person's instruction",
  ),
  p(
    'approver-identity',
    35,
    "only the office's owner can answer an approval; nobody else's yes counts",
  ),
  p(
    'anon-surface',
    21,
    'the public anon key reaches no function or table it should not (exposure proven able to fail)',
  ),
  p(
    'public-views-closed',
    16,
    "a public key reaches no view in public (14 views run with the owner's rights and bypassed row security), the office roles still do, and the proof fails without migration 1053",
  ),
  p('google-office-binding', 15, "a Google job in one office never borrows another office's token"),

  // ---- approvals and the human-contact boundary ----------------------------------------------------------------------
  p(
    'approval-binding',
    24,
    'an approval is bound to the exact action and question it was raised for and is spent once',
  ),
  p(
    'approval-execution',
    12,
    'an approved action performs exactly what was approved, and only after the yes',
  ),
  p(
    'approval-delivery',
    7,
    'the question reaches the person who must answer it, by the channel they use',
  ),
  p(
    'authority',
    70,
    'the dial-by-tool-by-origin policy: a level-3 action can never proceed unasked on any dial',
  ),
  p('typed-yes', 7, 'a typed "yes" binds to the question he was SHOWN and to no other'),
  p(
    'question-binding',
    30,
    'an answer reaches the question it names, in the conversation it came from',
  ),
  p(
    'forwarded-authority',
    6,
    'forwarded or pasted text is never the owner speaking, so it authorises nothing',
  ),
  p(
    'forwarded-writers',
    17,
    'a forwarded instruction does not tick, cancel or create a task (every writer is driven)',
  ),
  p('turn-entitlement', 10, 'a turn may only start what its own words entitle it to start'),
  p(
    'e2e-boundary',
    7,
    'the 720-cell policy matrix: no outward act proceeds without its gate, a disabled tool never proceeds',
  ),
  p(
    'service-decides-nothing',
    4,
    'a channel adapter only translates: the office key is not allowed to decide for a person',
  ),
  p(
    'audit-closure',
    25,
    "a job's origin decides asked-for (an office-made root is not a person asking); a job's parent is written once; a called-off job is not restarted by a late yes",
  ),

  // ---- containment: harness traffic never reaches a real person ------------------------------------------------------
  p(
    'containment',
    15,
    'a harness job is refused any real destination; a real one is still claimable',
  ),
  p(
    'external-containment',
    15,
    'external-assistant and test-origin turns never reach his real chat',
  ),
  p('chat-containment', 4, 'a harness conversation never appears in his real chat history'),
  p('narration-containment', 9, 'narration of harness work is not spoken to him'),
  p('correction-containment', 4, 'a correction typed by a harness is not learned as his rule'),
  p('task-content-containment', 4, 'text a task carries can never be an instruction to act'),
  p(
    'synthetic-origins',
    29,
    'a turn that did not come through a production door is synthetic and can act on nothing real',
  ),
  p(
    'test-origins',
    37,
    'a declared test origin is refused every real delivery and is never stamped real',
  ),
  p(
    'job-origin',
    17,
    "a job's origin class (trusted, internal, harness, unknown) is derived from what each door writes",
  ),

  // ---- job execution, recovery and the word owed ---------------------------------------------------------------------
  p(
    'job-lifecycle',
    21,
    'a job moves only through legal states, retries are bounded, and exhausted attempts fail WITH a reason',
  ),
  p(
    'job-fence',
    18,
    'one claim per job: a stale claim is fenced and can neither complete nor write',
  ),
  p('exactly-once', 5, 'a duplicate webhook, job or child produces one of each'),
  p(
    'terminal-job-owes-a-word',
    14,
    'a job that ends with no answer owes the person one sentence, once',
  ),
  p(
    'parked-turn-owes-a-word',
    20,
    'a turn parked for a person says so, and is not silently dropped',
  ),
  p(
    'office-fairness',
    18,
    "one office cannot starve another of the worker, and an overspender's background work is held, never a person's conversation",
  ),
  p(
    'dequeue-reconciled',
    20,
    "efficiency's lazy ceiling carried onto 1044's fair-share dequeue claims what 1044 claims; applying efficiency's 1030 as written would lose the fairness (deferred, proved, guarded)",
  ),
  // The script prints WRONG rows on purpose for the `pre` control (the schema WITHOUT 0599, where recovery must fail); its
  // own exit code is what judges that half, so only an explicit CONTROL FAILED line is counted as a failed assertion here.
  via(
    'script',
    'recovery-matrix',
    18,
    'every stallable job state is recovered or failed, and a malformed row is contained as a warning',
    { okRe: '\\|\\s*ok\\s*$', failRe: 'CONTROL FAILED', timeoutS: 240 },
  ),
  p(
    'drain-survives-sweep',
    1,
    'one broken job cannot stop the office: the drain still runs the healthy job beside it',
    { okRe: '^PASS:', failRe: '^FAIL' },
  ),
  via(
    'script',
    'approval-race',
    2,
    'two overlapping answers to one question perform the action ONCE (with the control that shows two without the fix)',
    { okRe: '^(PASS|CONTROL red)', failRe: '^(FAIL|CONTROL DID NOT)', timeoutS: 240 },
  ),

  p(
    'worker-failure-paths',
    11,
    "the worker records a handler failure through a short database blip (retrying with the handler reason, not left running), never retries a refused statement, never spends an attempt twice on a persistent outage, recovers once under concurrent sweeps, and never touches another office's live job",
  ),
  p(
    'fallback-turns',
    16,
    "a backup model's answer is admitted on evidence (off-target, unsupported-inference and routing-narration answers are refused and replaced by a second opinion from a different model, then by an honest limitation built from the evidence), a good backup answer is delivered unchanged, a first-choice answer is never second-guessed, and a turn a backup model helped work out asks before it changes anything",
  ),
  // ---- provenance, retrieval scope and the drivers that exercise whole journeys --------------------------------------
  p(
    'project-provenance',
    15,
    'a project is only ever stated by the person who named it; a malformed or foreign one costs the project, not the message',
  ),
  p('guidance-stated', 6, 'what Grant said is stated to the model as an order, with who said it'),
  p(
    'mcp-cannot-answer',
    6,
    'an external assistant cannot answer an approval or reach another office through MCP',
  ),
  p(
    'e2e-mcp',
    40,
    'the MCP server isolates 13 tools per office, has no delete tool, and refuses a revoked client',
  ),
  p(
    'e2e-documents',
    48,
    'documents of every type are ingested, hostile files are bounded, retrieval is project- and office-scoped',
  ),
  p(
    'e2e-tasks',
    70,
    'task mutation: create, mine vs team, complete, delete, search, reminders and retry de-duplication through the real doors',
  ),
  p(
    'e2e-convergence',
    88,
    'Telegram text and voice, Slack, Team HQ chat and the call write the same ledger, the same job and the same task writer',
  ),
  p(
    'e2e-duties-budget',
    29,
    "duties and budgets are per-office; an office's background work can be held without parking a person's conversation",
  ),
  p(
    'e2e-failure',
    41,
    'delivery and failure paths: retries are bounded, a failure is said once, nothing is sent twice',
  ),
  p(
    'v1-acceptance-a',
    100,
    'Version 1 journeys A-F and L through the real doors, worker and delivery: reminders (dated, date-only, recurring), task completion, a draft that is not sent, the human-contact boundary, duplicate input',
  ),
  p(
    'v1-acceptance-b',
    105,
    'Version 1 journeys G-K, M and N: autonomous work that parks an outward step, delegation fan-in, Team HQ continuity, model failure and delivery failure, untrusted content, cross-office attack',
  ),
  p(
    'tg-chief-addressing',
    43,
    "Telegram addressing with the production bot shape (the chief's bot the only one enabled, slug chief-of-staff), selective delegation: a routine message to the chief's bot is hers alone (no roster, no routing model call, no child), an explicit request for the team or named colleagues convenes them, one answer back through the same bot to the same chat, and an email pasted into a message is content (its instructions are not his, the model still reads it); a message to a specialist's bot stays directly addressed with nobody else convened; approvals, retries, duplicates and another office",
  ),

  p(
    'cross-interface-delegation',
    12,
    'the same instruction makes the same delegation decision on Telegram, Slack and Team HQ: routine requests stay with Claire (no roster, no routing model call, no child, a long paste included), an explicit team request or genuinely investigative work convenes, a specialist he addressed still answers',
  ),
  p(
    'message-ordering',
    17,
    "a delegated request's lifecycle is an ordering invariant held by state, under real concurrency: the synthesis waits for the lead's reply, a retrying lead send is not overtaken, a stuck lead cannot hold the answer for ever and its late reply is suppressed as superseded, many workers deliver each once",
  ),

  // ---- reminders, state changes and delivery redrive (7 October implementation run) ----------------------------------
  p(
    'reminder-harness',
    7,
    "a real person's due reminder is listed and a HARNESS task's is not (the gate's own sabotage found nothing asserted this), with the reader's controls and an isolation neighbour",
  ),
  p(
    'tk-reminders',
    68,
    'a reminder fires at the office clock (date-only, recurring, three time zones), through the real handler and the real tasks.remind duty; a harness task is never reminded',
  ),
  p(
    'rm-series',
    60,
    'completing a recurring reminder completes that time only (skipped before it fires, recorded after, never a duplicate row or firing); only an explicit stop ends the series; clock changes in three zones, month and year end, a long outage',
  ),
  p(
    'tk-state-changes',
    28,
    'one sentence has one effect: a state change changes exactly one task and adds none, a creation adds exactly one, a non-match changes nothing',
  ),
  p(
    'dl-delivery-redrive',
    54,
    'a finished answer is redriven until it is sent or visibly given up, never left claimed, and a failed or uncertain one puts ONE question on the person list (never auto-resent, resolvable by his answer, none for harness traffic)',
  ),

  // ---- the unified activity ledger (1060, 1061; default off) ---------------------------------------------------------
  p(
    'activity-ledger',
    62,
    'the one activity history is read from the tables that own each fact, never invents or copies one, shows nothing of a suite, cannot cross an office, redacts what it stores, takes an idempotent and concurrent write, refuses an update or a forged external report, and fails closed',
  ),
  p(
    'activity-ledger-review',
    20,
    "each defect the independent review demonstrated stays fixed: no yes or no is invented for an answer the data cannot classify, a person-marked delivery is not provider-confirmed, a stopped job is the person's, a job filter includes every descendant, a fixture project's job-less rows are hidden, a selective filter on a busy office is complete, the page gets slugs, and a chain says when it is not complete",
  ),
  p(
    'activity-gateway',
    14,
    'the same ledger through the real hq-api gateway: each person reads only their own, a malformed id, instant, word or count is refused by name, a cursor never skips or repeats an event, and switched off it answers nothing',
  ),

  // ---- the migration history itself ----------------------------------------------------------------------------------
  p(
    'replay-parity',
    7,
    'the whole migration history replayed into an EMPTY database builds a schema fingerprint-identical to the candidate',
  ),
]
