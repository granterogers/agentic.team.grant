/**
 * TIER (c): EXTENDED forensic and audit proofs. `npm run verify:extended` (or `verify:proofs` for tiers b and c together).
 *
 * Everything that is worth keeping and passes, but is not what stops a person being harmed if it goes red for a day:
 * feature walkthroughs, characterisations, the seven policy decisions, the Sample's showcase, migration-specific proofs
 * and drivers that need a browser or a heavy setup. Run on demand and before a release; the runner holds them to the same
 * rule as tier (b) (own clone, exit code, assertion floor, zero-assertion flag).
 *
 * To add a proof: ONE line, `p('<name>', <floor>, '<what it guards>')`.
 */
import { p, via } from './p.ts'
import type { Proof } from './types.ts'

export const EXTENDED: readonly Proof[] = [
  // ---- the Chief of Staff registry and its writers (moved here from the critical tier, which is capped at 70) -----------
  p(
    'registry-never-asks',
    4,
    'the registry tells the office never to ask Grant for a Gmail query, a message choice or a Notion workspace',
  ),
  p(
    'work-carries-its-project',
    2,
    'the conversation work the duplicate guard weighs says which project each piece is for, so another project is never a repeat',
  ),
  p(
    'specialist-reassign',
    6,
    'a failed specialist hand-off is reassigned to the Chief of Staff once; the Chief of Staff own failure is not',
  ),
  p(
    'task-owner-writes',
    3,
    'a plan task is stored with its specialist or the Chief of Staff as owner, never unowned or refused silently',
  ),
  p(
    'status-answers-from-state',
    5,
    'a status question is answered from the conversation work as recorded: queued work is still underway, and failed work is no longer shown as underway',
  ),
  p(
    'status-while-blocked',
    2,
    'a status question about a piece paused on an open question says it is waiting on Grant, and stops saying so once he has answered',
  ),
  p(
    'duplicate-while-stalled',
    2,
    'a repeat of work whose first attempt has stalled (lease lapsed) starts nothing; a repeat the matcher calls different work starts a new piece (the control)',
  ),
  p(
    'mail-awaiting',
    4,
    'a quiet thread is awaiting a reply in the right direction and is named for the counterpart, never Grant; recent and non-contact threads are not listed',
  ),
  p(
    'mail-paging',
    4,
    'the Gmail reader follows every page of a listing, stores a message that appears on two pages once, and reads one page when there is no next token (the control)',
  ),
  p(
    'duplicate-after-completion',
    2,
    'a repeat of work that already completed is answered with its result and starts nothing; a repeat the matcher calls different work starts a new piece (the control)',
  ),
  p(
    'duplicate-while-running',
    3,
    'a repeat of work already running starts no second piece of work, identical or paraphrased; a paraphrase the matcher calls different work does start one (the control)',
  ),
  p(
    'approval-concurrent-presses',
    2,
    'two button presses that reach the office at the same moment: exactly one answers the question and the other is refused as already answered, in every round',
  ),
  p(
    'approval-consumed-once',
    4,
    'an approval is answered once: a repeated or conflicting press does not change the answer, and an option never offered is refused and leaves the question open',
  ),
  // ---- the unified activity ledger -------------------------------------------------------------------------------------
  p(
    'activity-worker',
    8,
    "the worker's recovery sweep records one system.recovered event per reclaimed job, once, only when the ledger is on, and never fails the sweep when the ledger cannot be written",
  ),
  p(
    'activity-ledger',
    62,
    'the one activity history is read from the tables that own each fact, never invents or copies one, shows nothing of a suite, cannot cross an office, redacts what it stores, takes an idempotent and concurrent write, refuses an update or a forged external report, and fails closed',
  ),
  p(
    'activity-gateway',
    14,
    'the same ledger through the real hq-api gateway: each person reads only their own, a malformed id, instant, word or count is refused by name, a cursor never skips or repeats an event, and switched off it answers nothing',
  ),
  p(
    'activity-ledger-review',
    35,
    "each defect the independent review demonstrated stays fixed: no yes or no is invented for an answer the data cannot classify, a person-marked delivery is not provider-confirmed, a stopped job is the person's, a job filter includes every descendant, a fixture project's job-less rows are hidden, a selective filter on a busy office is complete, the page gets slugs, a chain says when it is not complete, the external door cleans and bounds what a worker sends, and no HTTP role can reach a writer",
  ),
  p(
    'activity-ledger-equivalence',
    8,
    'a filter on the activity read model (severity, category, type, agent, project, job, correlation, alone and combined) returns exactly what filtering the whole history afterwards returns, by id and in order, never partial; shown red by a pushdown predicate made too narrow',
  ),
  p(
    'activity-indexes',
    11,
    'the read model access paths are built one at a time with CREATE INDEX CONCURRENTLY while the worker keeps writing: no write refused or stalled, a plain build of the same index shown to stall (the control), a second run changes nothing, an invalid leftover is dropped and rebuilt, and the health reading names what is missing',
  ),
  p(
    'activity-native-writers',
    14,
    'tool-call events are written through the real TypeScript writer and carry the capability, step and outcome but never an input, output or error message; holding an over-budget agent back records budget.threshold_reached once a day (and nothing while the switch is off, the held-back behaviour unchanged); a rate-limit pause is an integration.rate_limited event projected from job_pauses; a broken ledger cannot fail a step',
  ),
  p(
    'activity-ledger-durability',
    11,
    'audit durability by class: a critical type is refused by the best-effort writer and a failed strict record fails the change in its own transaction; with the ledger table (and then its failure counter) deliberately broken the best-effort writer returns null, never raises and writes nothing about itself; the failure counter is bounded',
  ),
  p(
    'activity-redaction',
    60,
    'the SQL strict redactor the ledger stores through and its TypeScript twin agree byte for byte on every credential family, evasion and neighbour, in linear time, and the limits are pinned',
  ),
  p(
    'activity-office-scope',
    16,
    'the ledger fails closed: only an explicit master plus a valid office list or the explicit all-offices setting turns an office on; absent, null, empty, malformed, unknown-version and mixed settings turn it on for nobody; every writer and reader obeys one decision; the operator statements cannot broaden under a race or an interruption; and switching off deletes nothing',
  ),
  p(
    'activity-external-attack',
    47,
    'the external-worker door under concurrent writers holds its 300 per worker and 1000 per office, cannot be varied past by name or key, cannot claim a review, confirmation or approval, and the ledger tables are closed to browser roles and to edits',
  ),
  p(
    'activity-storage',
    9,
    'what the ledger costs in storage on the final schema: the three migrations add under 2 MB, the eleven read indexes cost a bounded number of bytes per row of the tables they index, a typical native event is under 1 KB with its indexes and the largest payload the table accepts under 6 KB, every kind is stored once and a replay adds nothing',
  ),
  p(
    'activity-archive-rehearsal',
    10,
    'old diagnostic events can be exported with a checksum, removed from the live table (on a disposable replica only) and restored byte for byte, the Activity read answers over what is left and again over the restored window, and no consequential event is ever in the slice',
  ),
  p(
    'activity-scaling',
    14,
    "a small office's Activity read does not grow with other offices' volume (one to eight copies of a busy history in unrelated offices, same events in the same order, none foreign), a read that cannot finish in its time budget is refused with PT504 between passes and never answered short, and a caller-armed statement timeout cancels a running read cleanly",
  ),

  // ---- answers, acknowledgements, questions --------------------------------------------------------------------------
  p(
    'acknowledgement',
    25,
    'a short "yes please" or "no thanks" answers the one open question it plainly means',
  ),
  p(
    'acknowledgement-sequence',
    28,
    "a run of acknowledgements answers questions in order and never the wrong chat's",
  ),
  p('ask-unasked-loop', 15, 'the office does not ask the same question again once it was answered'),
  p('open-question', 38, 'what is waiting on a person is findable, bounded and attributed'),
  p('refusal-reversal', 32, 'a refusal can be reversed by the owner and by nobody else'),
  p('blocker-failure', 5, 'a failed blocker answer is said, not swallowed'),
  p('step-question', 5, 'a step of a plan that needs a yes asks, and the yes resumes the plan'),
  p('outward-options', 9, 'an outward offer only promises what its press can perform'),
  p('drive-options', 3, 'the Drive question offers only options that can be honoured'),
  p('channel-options', 3, 'the channel question offers only channels that exist'),
  p('authority-characterization', 14, 'the authority matrix as it stands today (characterisation)'),
  p(
    'mixed-turns',
    14,
    'a message carrying several intents is each handled, and the rule inside it is stored whole',
  ),
  p(
    'paused-incoherent',
    6,
    'a job paused on an incoherent answer is resumed with the refusal in view',
  ),

  // ---- jobs, delegation, delivery ------------------------------------------------------------------------------------
  p(
    'job-delegation',
    8,
    'a child job inherits project, requester and correlation; fan-in waits for every sibling',
  ),
  p('fan-in-waits', 5, 'a synthesis waits for the specialists it convened'),
  p(
    'capacity-warning',
    27,
    'the free-tier headroom warning agrees between SQL and TypeScript on every case',
  ),
  p('ci-voice-ledger', 7, 'the voice call ledger and the CI spend ledger record what ran'),
  via(
    'script',
    'backup-restore-typed',
    57,
    "a backup taken by the repository's own code restores with real types, constraints and composite keys (with controls that must go red)",
    { timeoutS: 540 },
  ),

  // ---- containment, witnesses and origins (the neighbours of tier b) -------------------------------------------------
  p('legit-origins', 19, "every real production door's origin shape is still accepted as real"),
  p(
    'witness-independence',
    9,
    'the leak witnesses do not ask the same predicate as the guard they check',
  ),
  p('witness-test-origins', 8, 'a declared test origin is visible to the witnesses'),
  p('destination-retirement', 10, 'a retired test destination is never deleted, only retired'),
  p('history-shapes', 6, 'conversation history reads every stored shape of a turn'),
  p(
    'telegram-voice-test-origin',
    5,
    'a declared voice test origin spends no runner dispatch and sends nothing',
  ),
  p('empty-command-id', 10, 'an empty command id is no command, in every reader'),
  p('enumeration-agreement', 7, 'two readers of one list agree on what is in it'),

  // ---- the seven policy decisions ------------------------------------------------------------------------------------
  p('policy-vikunja', 20, 'policy decision: Vikunja'),
  p('policy-slack-channels', 18, 'policy decision: Slack channels'),
  p('policy-notion', 12, 'policy decision: Notion'),
  p('policy-slack-rotation', 15, 'policy decision: Slack token rotation'),
  p('policy-learning', 18, 'policy decision: what the office may learn and from whom'),
  p('policy-retrieval', 12, 'policy decision: cross-project retrieval'),
  p('policy-proactive', 21, 'policy decision: proactive autonomy'),

  // ---- documents, knowledge, retrieval -------------------------------------------------------------------------------
  p('retrieval-scope', 3, 'retrieval reads only the scope of the turn'),
  p('detach-retrieval', 19, 'a disconnected source leaves active retrieval'),
  p('document-preview', 39, 'a document previews as what it is'),
  p('chunks', 33, 'long documents are chunked and found by their passages'),
  p('drive-index', 29, 'the Drive index covers what is attached'),
  p('import-fetch', 30, 'importing a document fetches only what was asked for'),
  p('import-source-gate', 27, 'an import is gated by its source'),
  p(
    'project-documents',
    88,
    "a project's documents are logical items with versions and an explicit import",
  ),
  p('project-ownership', 5, 'a project belongs to one office'),
  p('project-calendar', 60, 'project calendar events'),
  p('project-calendar-conflict', 17, 'calendar conflicts are found and said'),
  p('style-keep', 19, "a person's style is kept across versions"),
  p('web-research', 23, 'web research is bounded and attributed (rolled back)'),
  p('google-connections', 28, 'a Google connection is one per office with a durable state'),
  p(
    'google-connection-backfill',
    48,
    'the Google connection backfill states only what the evidence shows',
  ),

  // ---- channels and the Sample ---------------------------------------------------------------------------------------
  p('slack-oauth', 17, 'Slack install: the callback binds a workspace to one office'),
  p('slack-send', 20, 'Slack send: answers come back to the installing person'),
  p('slack-sender', 18, 'Slack sender identity'),
  p('telegram-link', 14, 'Telegram link: connect and disconnect for a non-operator'),
  p('vault-export-door', 4, 'the vault export door refuses everyone but the operator'),
  p('vikunja-health', 19, 'Vikunja health is reported honestly'),
  p('sample-dates', 8, "the Sample's dates stay believable"),
  p('sample-gateway', 26, 'the Sample is read-only through the gateway'),
  p('sample-office', 37, 'the Sample office is built and refuses writes'),
  p('sample-showcase-readers', 28, 'what a Sample visitor reads is the showcase and nothing else'),

  // ---- characterisations and drivers that print findings, not assertions ---------------------------------------------
  p(
    'e2e-instructions',
    0,
    'how thirteen natural-language instructions are classified and routed (a printed characterisation, no assertions)',
    { informational: true },
  ),

  // ---- a real browser (slow; needs Chromium and the proxy CA, see CLAUDE.md `npm run trust:proxy-ca`) -----------------
  p(
    'combined-browser',
    70,
    "Team HQ in a real browser as a person and as a Sample visitor: draws, no overflow at the phone width (390 and the narrowest, 320, where the project's name is at least 70px: #453), a guest's writes refused",
    { args: ['--only=320,390'], timeoutS: 500 },
  ),
  p(
    'chat-dock-browser',
    30,
    'Team Chat dock, real page and real voice door: one typed message is one command for the right person and project, a lost response is retried under the same message name and filed once, and a second visit lands in the same conversation',
    { timeoutS: 420 },
  ),
  p(
    'series-ui-browser',
    46,
    'Team HQ My Tasks, real page and real gateway: ticking a recurring reminder completes that time only, Stop repeating is its own press that asks twice and cancels exactly that series (also from the Repeating reminders section when it is not due: #450), stopping again is a no-op, another office cannot stop it, and the proof reads the database (a refused stop turns it red)',
    { timeoutS: 420 },
  ),

  // ---- migration-specific and structural proofs ----------------------------------------------------------------------
  via(
    'plants',
    'p2-backfill-plants',
    18,
    'the ownership backfill ABORTS on data it cannot prove (six plants and a control)',
    { timeoutS: 300 },
  ),
  via(
    'fk',
    'ownership-composite-fk',
    31,
    'the composite ownership keys hold under a role that bypasses row security (needs the schema BEFORE 0654)',
    { timeoutS: 300 },
  ),
  via('sql', 'ux-activity-via', 1, 'migration 0920: Activity says which door', {
    file: 'ux-be/01-activity-via',
    okRe: 'PASS 01',
  }),
  via('sql', 'ux-project-search', 1, "project search finds only the office's own", {
    file: 'ux-be/02-project-search',
    okRe: 'PASS|all checks passed',
  }),
  via('sql', 'ux-mcp-tools', 1, 'MCP tools per office', {
    file: 'ux-be/03-mcp-tools',
    okRe: 'PASS 03',
  }),
  via(
    'sql',
    'ux-style-profiles',
    1,
    "style profiles are one per person and never another office's",
    { file: 'ux-be/04-style-profiles', okRe: 'PASS 04' },
  ),
  via(
    'sql',
    'ux-mcp-calendar',
    1,
    "the MCP calendar tools read and write only the caller's office",
    { file: 'ux-be/05-mcp-calendar', okRe: 'PASS 05' },
  ),
  via('sql', 'ux-web-sources', 1, "web sources a project reads are the project's own and bounded", {
    file: 'ux-be/05-web-sources',
    okRe: 'all checks passed',
  }),
  via(
    'sql',
    'ux-audit-1021',
    1,
    'migration 1021 audit proof (ends in a deliberate PROOF_OK exception)',
    { file: 'ux-be/07-audit-1021', okRe: 'PROOF_OK', okRc: 3 },
  ),
  p('ux-artifacts', 1, 'the report pipeline end to end with a fake model (rolled back)', {
    file: 'ux-be/05-artifacts',
    okRe: 'ALL PASSED',
  }),
  p(
    'ux-style-adopt',
    1,
    "adopting a style changes the report's colours and records what was adopted",
    { file: 'ux-be/06-style-adopt', okRe: 'ALL PASSED' },
  ),
]
