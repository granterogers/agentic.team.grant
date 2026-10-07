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
  via('p2', 'office-ownership', 76, 'Person A, Person B, the Sample, the Test office and System cannot read or write one another\'s rows (96 attacks)'),
  via('p2', 'office-ownership-sabotage', 8, 'the isolation suite is proven able to FAIL: each way the structure is weakened turns it red, then restored it is green', { file: 'office-ownership-sabotage', timeoutS: 420 }),
  via('p3', 'p3-app-attack', 1100, 'every application door (gateway, Telegram, Slack, MCP, voice, upload, workers) is tried as the wrong person (1,421 attacks)'),
  p('p1-operator', 21, 'a second person reaches none of the operator-only actions and sections'),
  p('p1-storage-order', 15, 'a storage read or write by an unknown or officeless caller is refused BEFORE any storage call is made'),
  p('p1-credentials', 26, 'a credential is read through ONE office-scoped resolver; one office never resolves another\'s secret'),
  p('principals', 66, 'who is a person, a harness, a guest or unknown is decided in one place and unknown is never trusted'),
  p('sender-authorization', 31, 'a message from somebody who is not the office\'s person is not that person\'s instruction'),
  p('approver-identity', 35, 'only the office\'s owner can answer an approval; nobody else\'s yes counts'),
  p('anon-surface', 21, 'the public anon key reaches no function or table it should not (exposure proven able to fail)'),
  p('google-office-binding', 15, 'a Google job in one office never borrows another office\'s token'),

  // ---- approvals and the human-contact boundary ----------------------------------------------------------------------
  p('approval-binding', 24, 'an approval is bound to the exact action and question it was raised for and is spent once'),
  p('approval-execution', 12, 'an approved action performs exactly what was approved, and only after the yes'),
  p('approval-delivery', 7, 'the question reaches the person who must answer it, by the channel they use'),
  p('authority', 70, 'the dial-by-tool-by-origin policy: a level-3 action can never proceed unasked on any dial'),
  p('typed-yes', 7, 'a typed "yes" binds to the question he was SHOWN and to no other'),
  p('question-binding', 30, 'an answer reaches the question it names, in the conversation it came from'),
  p('forwarded-authority', 6, 'forwarded or pasted text is never the owner speaking, so it authorises nothing'),
  p('forwarded-writers', 17, 'a forwarded instruction does not tick, cancel or create a task (every writer is driven)'),
  p('turn-entitlement', 10, 'a turn may only start what its own words entitle it to start'),
  p('e2e-boundary', 7, 'the 720-cell policy matrix: no outward act proceeds without its gate, a disabled tool never proceeds'),
  p('service-decides-nothing', 4, 'a channel adapter only translates: the office key is not allowed to decide for a person'),
  p('audit-closure', 25, 'a job\'s origin decides asked-for (an office-made root is not a person asking); a job\'s parent is written once; a called-off job is not restarted by a late yes'),

  // ---- containment: harness traffic never reaches a real person ------------------------------------------------------
  p('containment', 15, 'a harness job is refused any real destination; a real one is still claimable'),
  p('external-containment', 15, 'external-assistant and test-origin turns never reach his real chat'),
  p('chat-containment', 4, 'a harness conversation never appears in his real chat history'),
  p('narration-containment', 9, 'narration of harness work is not spoken to him'),
  p('correction-containment', 4, 'a correction typed by a harness is not learned as his rule'),
  p('task-content-containment', 4, 'text a task carries can never be an instruction to act'),
  p('synthetic-origins', 29, 'a turn that did not come through a production door is synthetic and can act on nothing real'),
  p('test-origins', 37, 'a declared test origin is refused every real delivery and is never stamped real'),
  p('job-origin', 17, 'a job\'s origin class (trusted, internal, harness, unknown) is derived from what each door writes'),

  // ---- job execution, recovery and the word owed ---------------------------------------------------------------------
  p('job-lifecycle', 21, 'a job moves only through legal states, retries are bounded, and exhausted attempts fail WITH a reason'),
  p('job-fence', 18, 'one claim per job: a stale claim is fenced and can neither complete nor write'),
  p('exactly-once', 5, 'a duplicate webhook, job or child produces one of each'),
  p('terminal-job-owes-a-word', 14, 'a job that ends with no answer owes the person one sentence, once'),
  p('parked-turn-owes-a-word', 20, 'a turn parked for a person says so, and is not silently dropped'),
  p('office-fairness', 18, 'one office cannot starve another of the worker, and an overspender\'s background work is held, never a person\'s conversation'),
  via('script', 'recovery-matrix', 10, 'every stallable job state is recovered or failed, and a malformed row is contained as a warning', { file: 'recovery-matrix', okRe: '\\|\\s*ok\\s*$', failRe: 'WRONG|CONTROL FAILED', timeoutS: 240 }),
  p('drain-survives-sweep', 1, 'one broken job cannot stop the office: the drain still runs the healthy job beside it', { okRe: '^PASS:', failRe: '^FAIL' }),
  via('script', 'approval-race', 2, 'two overlapping answers to one question perform the action ONCE (with the control that shows two without the fix)', { file: 'approval-race', okRe: '^(PASS|CONTROL red)', failRe: '^(FAIL|CONTROL DID NOT)', timeoutS: 240 }),

  // ---- provenance, retrieval scope and the drivers that exercise whole journeys --------------------------------------
  p('project-provenance', 15, 'a project is only ever stated by the person who named it; a malformed or foreign one costs the project, not the message'),
  p('guidance-stated', 6, 'what Grant said is stated to the model as an order, with who said it'),
  p('mcp-cannot-answer', 6, 'an external assistant cannot answer an approval or reach another office through MCP'),
  p('e2e-mcp', 40, 'the MCP server isolates 13 tools per office, has no delete tool, and refuses a revoked client'),
  p('e2e-documents', 48, 'documents of every type are ingested, hostile files are bounded, retrieval is project- and office-scoped'),
  p('e2e-tasks', 65, 'task mutation: create, mine vs team, complete, delete, search, reminders and retry de-duplication through the real doors'),
  p('e2e-convergence', 70, 'Telegram text and voice, Slack, Team HQ chat and the call write the same ledger, the same job and the same task writer'),
  p('e2e-duties-budget', 29, 'duties and budgets are per-office; an office\'s background work can be held without parking a person\'s conversation'),
  p('e2e-failure', 15, 'delivery and failure paths: retries are bounded, a failure is said once, nothing is sent twice'),

  // ---- the migration history itself ----------------------------------------------------------------------------------
  p('replay-parity', 5, 'the whole migration history replayed into an EMPTY database builds a schema fingerprint-identical to the candidate'),
]
