/**
 * The Team HQ read API.
 *
 * One endpoint, four sections, no SQL from the client — ever. The browser names
 * a SECTION from a fixed list and the projection lives in `app.hq_*` (0045)
 * where it can be reviewed. Letting a page send a query, or even a table name,
 * is how a private dashboard becomes a data export.
 *
 * The RPCs it calls are the `public` wrappers from 0046, not the `app`
 * functions themselves: PostgREST serves only the schemas it is configured for.
 * That cost a silent failure in the Telegram webhook before it was understood,
 * and it is written down here so the next endpoint does not rediscover it.
 *
 * ## Why it is not PostgREST with the anon key
 *
 * The obvious build is: expose the tables, hand the browser the publishable
 * key, write RLS. Three problems, and the third is the one that settles it.
 *
 *   1. The RLS in this database is written for `ai_team_app`, a server role.
 *      Rewriting every policy for an anonymous browser is a large change to the
 *      security model in service of a dashboard.
 *   2. `usable_models` and `credential_health` carry `secret_ref`. Not secrets,
 *      but exactly the "token/debug detail" §25 says must not appear.
 *   3. There is one user and no login. Any key the page holds is a key anyone
 *      holding the URL holds, so the question is only ever "what can that key
 *      do" — and the answer should be "read four fixed shapes", not "query the
 *      database".
 *
 * ## The token
 *
 * A single bearer token, compared in constant time. It is not a password and
 * not a session: it is a capability, it grants exactly these four reads, and it
 * can be rotated by changing one vault row. Grant keeps it in the page's
 * `localStorage`.
 *
 * `verify_jwt` is false because the browser has no Supabase JWT to present.
 * This token is the whole of the authentication, which is why an absent one
 * rejects everything rather than waving requests through.
 */

// Uploaded beside this file by scripts/deploy/hq.ts, from src/text/file-text.ts (pure, no dependencies).
import { fileText } from './file-text.ts'
import { authorizeUrl, revokeToken } from './oauth.ts'
import {
  driveProvider,
  type Failure,
  type PreviewPlan,
  previewDocument,
  streamDocument,
} from './preview.ts'

const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/**
 * Where to kick the worker, and why the dashboard needs to.
 *
 * Measured on real delivered traffic over fourteen days, `office.instruction`
 * from creation to being picked up:
 *
 *     telegram   median  1s     -- the webhook kicks
 *     slack      median  4s     -- the events endpoint kicks
 *     teamhq     median 46s     -- nothing kicks; it waits for pg_cron
 *
 * The Telegram webhook has kicked since Grant said *"I need the response to be
 * pretty much instant"*. `slack-events` was given the same thing later, and
 * its comment says why: *"a message typed in the office waited for the next
 * pg_cron tick"*. This is the THIRD door and it was never done — so the
 * surface Grant reads the office on is the slowest one to answer him.
 *
 * Same defect, same fix, third place. CLAUDE.md's rule is the one that
 * applies: when two functions do the same thing, grep for the other one.
 *
 * Empty means no kick, and the queue still drains on the one-minute floor: a
 * missing secret must degrade to "late", never to "lost".
 */
const WORKER_URL = Deno.env.get('WORKER_URL') ?? ''
const WORKER_KICK_SECRET = Deno.env.get('WORKER_KICK_SECRET') ?? ''

/**
 * Start a pass now, without waiting for it.
 *
 * Deliberately not awaited: a pass can take a minute and the dashboard is
 * waiting on this response. `waitUntil` keeps the runtime alive after the
 * response has gone, which is the shape this needs.
 *
 * Failures are swallowed on purpose. The kick is an accelerator, not the
 * delivery mechanism — pg_cron is behind it, so a kick that fails costs
 * latency and nothing else.
 *
 * Fired after any successful POST rather than for a named list of actions.
 * That is a property and not an enumeration: a GET is a read and can never
 * enqueue, a POST is a write and might, and a list of the actions that happen
 * to enqueue today is a list the next action added will not be on. An
 * unnecessary kick costs one function invocation that finds an empty queue;
 * a missing one costs Grant a minute.
 */
const kickWorker = (): void => {
  if (WORKER_URL === '' || WORKER_KICK_SECRET === '') return
  const kick = fetch(WORKER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${WORKER_KICK_SECRET}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'hq-api' }),
  }).catch(() => undefined)
  const keepAlive = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime?.waitUntil
  if (keepAlive === undefined) void kick
  else keepAlive(kick)
}

/*
  A GOOGLE ACCESS TOKEN, minted here and never sent anywhere near the browser.

  `google-oauth` does this same exchange for the same reason, and its comment
  is the rule: the secret is read HERE, with the service key, and there is
  deliberately no RPC that returns it. The page asks this function to look in
  Drive; it never holds a credential that could look for itself.

  Short-lived by construction - Google's token lasts an hour and nothing caches
  it beyond one request, so a browse and a pick each mint their own.
*/
const googleToken = async (
  operator: string,
  office: string,
): Promise<{ token: string } | { error: string }> => {
  const ask = async (fn: string, body: unknown): Promise<unknown> => {
    const r = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    return await r.json().catch(() => null)
  }
  const config = (await ask('hq_google', {})) as { client_id?: string } | null
  const id = String(config?.client_id ?? '')
  /*
    ONE resolver (0648): the database serves a Google credential only to a named operator or to work the
    deployment owns. A refusal arrives as an error OBJECT, never as a string, so only a string counts.
  */
  const held = async (p_name: string): Promise<string> => {
    // The office is the verified session's, never a caller-named one (P3): the resolver serves this office's own
    // credential to its operator and nothing of any other office's.
    const v = await ask('deployment_credential', {
      p_office: office,
      p_name,
      p_operator: operator,
      p_job: null,
    })
    return typeof v === 'string' ? v : ''
  }
  const secret = await held('google.client_secret')
  const refresh = await held('google.refresh_token')
  if (id === '' || secret === '' || refresh === '') {
    return { error: 'Google is not connected yet. Connect it in Settings and try again.' }
  }
  const got = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: id,
      client_secret: secret,
      refresh_token: refresh,
      grant_type: 'refresh_token',
    }),
  })
  const tokens = (await got.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
  }
  if (!got.ok || tokens.access_token === undefined) {
    /* The reason, never the credential. A refresh that fails usually means the
       grant was withdrawn, and saying so is what tells Grant to reconnect. */
    return {
      error: `Google would not renew the connection: ${String(tokens.error_description ?? got.status)}`,
    }
  }
  return { token: tokens.access_token }
}

/** The complete list. A section not named here does not exist. */
const SECTIONS: Readonly<
  Record<
    string,
    {
      fn: string
      /** The function takes `p_office` first; the gateway writes the verified one (P3). */
      office?: true
      args?: Record<string, unknown>
      /** A uuid, read from `?id=`. */
      arg?: string
      /**
       * Free text: which query parameter to read, and which RPC argument to
       * put it in. A PAIR rather than one name, because `?q=` reads better in
       * a URL than `?p_query=`, and which argument the RPC calls it is not the
       * caller's business. The first draft used one string for both and the
       * second section to need free text — `relations`, which wants `?kind=` —
       * could not express itself.
       */
      textArg?: { param: string; arg: string }
      /**
       * A word from a SHORT KNOWN LIST, read from a query parameter (#259).
       *
       * Not `textArg`, because a bucket is not free text: there are seven of
       * them and an eighth is a typo. And not a default in the RPC either —
       * CLAUDE.md records what it costs when a default value is also a
       * legitimate value, because nothing downstream can then tell "we decided
       * this" from "we did not know", and a misspelt bucket would quietly
       * serve the ordinary list.
       *
       * Refused here, by name, so the caller is told which word it did not
       * recognise rather than being shown something plausible.
       */
      oneOf?: { param: string; arg: string; values: readonly string[] }
      /**
       * OPTIONAL extras, each either a word list or free text (#259).
       *
       * `oneOf` and `textArg` are both REQUIRED when present — a section that
       * declares a bucket refuses a request without one, and a search section
       * refuses an empty query. Both are right for what they were written for
       * and neither can express "and you may also narrow this".
       *
       * My Tasks needs exactly that: a bucket it insists on, plus a search box
       * that is usually empty and a sort that usually is not given. Adding a
       * second `oneOf` field and a second `textArg` field would be two more
       * singular slots for the third case to outgrow, so this is a LIST and
       * each entry says which kind it is by whether it carries `values`.
       *
       * Absent means absent: the argument is not sent at all, so the RPC's own
       * default decides. That is the one place a default is right, because the
       * parameter being missing is not a typo — it is the ordinary request.
       */
      also?: readonly { param: string; arg: string; values?: readonly string[] }[]
      /** Whether `?project=<uuid>` narrows this section. Search only. */
      scoped?: boolean
      /**
       * Whether the named filter parameters compose into `p_filters` (#37).
       *
       * A flag on the SECTION rather than a check for the parameters being
       * present, for the same reason `scoped` is: passing `p_filters` to an
       * RPC with no such argument is an error, not a no-op.
       */
      filtered?: boolean
    }
  >
> = {
  overview: { fn: 'hq_overview', office: true },
  staff: { fn: 'hq_staff', office: true },
  usage: { fn: 'hq_usage', office: true },
  activity: { fn: 'hq_activity', office: true, args: { p_limit: 50 } },
  series: { fn: 'hq_series', office: true, args: { p_days: 30 } },
  connections: { fn: 'hq_connections', office: true },
  // Whether THIS person's Telegram is connected, waiting for a tap, or not (#410).
  channel_link: { fn: 'channel_link_status', office: true },
  // Whether THIS person's own Slack workspace is installed, waiting for the consent, or not, and what it can do (ADR-0065).
  slack_link: { fn: 'slack_link_status', office: true },
  projects: { fn: 'hq_projects', office: true },
  artifacts: { fn: 'hq_artifacts', office: true },
  settings: { fn: 'hq_settings', office: true },
  team: { fn: 'hq_team', office: true },
  // Everything the studio renders, in the shape web/studio/data.js already
  // exports (#68, ADR-0019). One call rather than nine: the studio paints the
  // whole shell at once and a page that fetches per section feels broken while
  // being correct — the argument 0120 made for the tool catalogue.
  studio: { fn: 'hq_studio', office: true },
  /*
    "Has anything changed" (#117, migration 0262).

    One row, five numbers and a timestamp. The studio polls this while the tab
    is in front of you and only refetches `studio` when the digest differs, so
    the common answer — nothing has happened — costs a few hundred bytes.

    Its own section rather than a field on `studio`, because the whole point is
    that it can be asked without paying for the payload it guards.
  */
  pulse: { fn: 'hq_pulse', office: true },
  // The Settings viewer, in the shapes settings.js already exports (#68).
  studio_settings: { fn: 'hq_studio_settings', office: true },
  /*
    The usage dashboard (#61), from `usage_overview` rather than `hq_usage`.

    Two functions, two shapes, and the studio wants the second: `hq_usage` is
    the old page's, grouped by subsystem; `usage_overview` is grouped by SERVICE
    with a quota and a provenance on each, which is what Grant asked for —
    *"a fraction of what's being spent over a monthly, weekly, daily quota"*.
    `web/studio/usage.js` was written in its exact shape.
  */
  usage_overview: { fn: 'usage_overview', office: true, args: { p_days: 30 } },
  /*
    One document, in full (#95).

    The FIRST section that takes a caller-supplied argument — every other one
    has fixed args baked in above. `arg` names the single RPC parameter the
    `id` query string is allowed to fill, so a section cannot be talked into
    passing something it did not ask for.

    It exists because `hq_studio` returns up to 24 documents per project and
    cannot carry their text: the longest document in the office is 180,000
    characters, and forty of those is not a first paint. So the grid gets
    metadata and opening one fetches it — the same reasoning as `lately`.
  */
  document: { fn: 'studio_document', office: true, arg: 'p_document_id' },
  /*
    THE UNIFIED DOCUMENTS LIST (0900). One item per logical document for a project, across Drive references, NotebookLM
    material, uploads and what the team generated, with source classification, import and index state and version
    count. `?slug=` names the project (free text, hence textArg, not a uuid).
  */
  project_documents: {
    fn: 'hq_project_documents',
    office: true,
    textArg: { param: 'slug', arg: 'p_slug' },
  },
  // The versions of one logical document, v1..vN, from any one of them (0900). A uuid, so `arg`.
  document_versions: { fn: 'hq_document_versions', office: true, arg: 'p_document_id' },
  /*
    HOW A MADE REPORT WAS MADE (0940, 0970): whether it has provenance, and whether the style it was set in was recorded
    (`has_style_snapshot`). The page asks before offering "Use this report's style for the project". A document with no
    provenance answers `{ has_provenance: false }`, not an error. A uuid, so `arg`.
  */
  document_provenance: { fn: 'hq_document_provenance', office: true, arg: 'p_document_id' },
  /*
    ONE OUTPUT, so the thing the team made can be READ (§19).

    The office has written thousands and there has never been a way to open
    one: importing it and deciding on it were both verdicts on something
    nobody could see.
  */
  output: { fn: 'hq_output', office: true, arg: 'p_output_id' },
  /*
    One project's conversation, both sides, in order (#192).

    Takes `?id=<project uuid>` through the same `arg` door as `document`, and
    for the same reason: the caller names WHICH conversation and nothing else.
    Project isolation is enforced inside `conversation_history` — both halves
    of the union filter on that project — so there is no widening parameter
    here and deliberately so.

    Its own section rather than a field on `studio`, because a conversation
    grows without bound and the shell must not pay for it on first paint. Same
    argument as `document` and `lately`. The RPC's own default is 50 messages;
    paging is by `p_before`, which no caller can reach yet — when the studio
    needs to scroll back, that becomes a second query parameter here.
  */
  /*
    Whether a task provider is connected, and anything it disagrees about
    (#259, Phase 2). ONE section rather than two: a panel whose two halves
    arrive in separate calls will eventually show a connected badge over an
    empty mapping, which is the row-list-built-twice defect with a screen in
    front of it.
  */
  task_sync: { fn: 'task_sync_panel', office: true },
  conversation: { fn: 'conversation_history', office: true, arg: 'p_project_id' },
  /*
    How fast the conversation is growing, and how much room is left (#204).

    Its own section for the same reason `pulse` is: it is a cheap question that
    should be answerable without paying for a payload it is not part of. And it
    is HERE rather than in a script because of the instruction that outranks
    most others — "I want to reduce my dependence on Claude or another coding
    interface for maintaining and extending the system." A number an agent has
    to run something to get is a number Grant does not have.
  */
  conversation_growth: { fn: 'conversation_growth', office: true },
  /*
    Which state each conversation surface is in (#198).

    Not a field on `connections`: that one answers "is this credential alive",
    and this answers "can Grant have a conversation there, and is anything
    wrong with it right now" — which needs the credential AND the traffic AND
    the last day of delivery failures together. Two questions, two sections.
  */
  conversation_channels: { fn: 'conversation_channels', office: true },
  /*
    The MCP server, as a page (#91).

    Its own section rather than part of `studio_settings`, because it is the
    only tab that reads three tables nobody else touches and putting it in the
    shared payload would make every settings open pay for it.

    Nothing in the RPC selects `token_sha256`. This tab gets captured by
    `npm run shots` and attached to a build step on a public page.
  */
  mcp: { fn: 'hq_mcp', office: true },
  // What the office did and what is being built, as one page (#68).
  lately: { fn: 'hq_studio_lately', office: true, args: { p_limit: 40 } },
  // The first-run checklist, for the Setting up pane (#68). `setup` already
  // exists above and serves the same function; named apart so the studio's
  // fetch is legible next to `studio` and `studio_settings`.
  studio_setup: { fn: 'hq_setup', office: true },
  google: { fn: 'hq_google' },
  // What to do next, for a person who has just opened this for the first time.
  setup: { fn: 'hq_setup', office: true },
  // What each kind of work costs, measured and modelled (§11).
  cost: { fn: 'hq_cost_per_outcome', office: true, args: { p_days: 30 } },
  // Which bot speaks as whom, and which are spare.
  bots: { fn: 'hq_bots' },
  // Who may message Grant directly, how loud a thing has to be to reach his
  // phone, and which recurring duties run at all (0151).
  routing: { fn: 'hq_routing', office: true },
  // What the build session is doing, as it does it — so Grant can open the page
  // instead of a terminal (0170).
  build: { fn: 'hq_build' },
  /*
    Every open task, across every project and none (#173, migration 0280).

    Its own section rather than a field on `studio`, for the reason `lately` and
    `document` are: the studio payload is what the first paint needs, and a
    portfolio task list is a screen you navigate TO. Folding it in would make
    every page load pay for a list most loads never render.
  */
  portfolio_tasks: { fn: 'hq_portfolio_tasks', office: true, args: { p_limit: 200 } },
  /*
    What the office learned, what it wants, what it noticed and what each agent
    could not do (#54, migration 0302).

    Its own section rather than a field on `studio`, for the reason `lately`
    and `portfolio_tasks` are: it reads four tables nobody else on the first
    paint touches, and governance is a screen you navigate TO.
  */
  governance: { fn: 'hq_governance', office: true, args: { p_limit: 40 } },
  /*
    What the office may do without asking, and what Grant has said not to ask
    about again (#15, migrations 0421 and 0422).

    Beside `governance` rather than inside it: governance is what the office
    LEARNED and WANTS, and this is what it is PERMITTED. The two answer
    different questions and one of them is a security surface, which is a
    reason to be able to read it on its own.

    No argument. A standing authorization scoped to one project still belongs
    on the one page that lists every permission in force — a security surface
    that can only be read a project at a time is one nobody audits.
  */
  standing: { fn: 'hq_standing', office: true },
  /*
    What the office has settled, and what that ruled out (#129).

    Its own section rather than a field on `governance`, for the reason
    `standing` is: governance is what the office LEARNED and WANTS, and this is
    what it CONCLUDED. And it is the one reading surface that deliberately
    crosses every project (ADR-0036), so folding it into a payload that is
    otherwise project-shaped would invite somebody to scope it.
  */
  decisions: { fn: 'hq_decisions', office: true, args: { p_limit: 40 } },
  /*
    What a project has MADE, as opposed to what it was given (#260).

    Audio overviews, slide decks, mind maps — the things NotebookLM generated,
    including the ones Grant made himself in its own interface, which the
    office adopts rather than ignoring.

    Named `project_artifacts`, not `artifacts`: there is already an `artifacts`
    section reading `hq_artifacts`, which is the GLOBAL list with the project
    name on each row. Two keys of one name in this object is not an error — the
    later one silently wins — which is how the first draft of this replaced a
    working section with a different one.

    Takes the project id, like every other project-scoped section. `openable`
    is on each row because NotebookLM does not expose a stable link for every
    type, and a page that drew an anchor regardless would be the fabricated
    link this Issue forbids.
  */
  project_artifacts: { fn: 'project_artifacts', office: true, arg: 'p_project' },
  /*
    What the team has made and Grant has not decided about (#28, #276).

    0315 closed half of the review gate — an unapproved document is not in the
    project's gallery — and the other half, letting one IN, had no control at
    all: `document_approve` and `document_discard` were gateway actions nothing
    in the page could press, which is what `check:pressable` found.

    The reader is `awaiting_review`, which had never returned a row in its
    life: it filtered a state nothing writes. 0471 widened it to the states
    that exist and gave it the row the page needs.
  */
  review: { fn: 'awaiting_review', office: true, arg: 'p_project' },
  /*
    WHO IS ASSIGNED TO A PROJECT, which is not the same question as who has
    touched it (§16).

    The Team screen derived its roster from whoever appeared in the project's
    tasks, activity and waiting items -- so it showed a record of activity
    wearing the name of a team, and a specialist assigned but not yet used was
    invisible on the screen where you assign people.

    `public.staff_on_project` reads `project_staff`, which is the table
    `set_project_staff` writes and the one the office itself means by "on this
    project". Section 16 asks for the Team screen to be where the team is
    configured, and a configuration screen that cannot see the thing it
    configures is the dial-with-no-reader defect with the parts swapped.
  */
  assigned: { fn: 'staff_on_project', office: true, arg: 'p_project_id' },
  /*
    THE WAY BACK FROM ARCHIVING (#276, migration 0480).

    `project_unarchive` was a gateway action nothing could press, so a
    dashboard project archived by mistake could only be recovered from SQL —
    and Project Settings gives Grant the button that archives one.

    The reader is not "every archived project". 926 of them are archived and
    not one holds a document, a task or a contact: they are suite subjects
    whose teardown could not delete them, and a list of those is the
    harness-traffic-as-failure defect on the surface built for recovering from
    a mistake. `recoverable_projects` asks whether the project HELD something,
    which is derived rather than named and therefore cannot go stale the way
    a list of prefixes does.

    No argument: it is global, like the governance sections, because a project
    you are trying to find is one you are not inside.
  */
  archived: { fn: 'recoverable_projects', office: true },
  /*
    MY TASKS (#259, ADR-0041).

    Grant's own to-do list, which is the same table as the office's project
    tasks with `assigned_to_human` true — the audit in ADR-0041 found that
    column already modelled, never once set, and read by nothing.

    Two sections rather than one: the list takes a bucket, and the counts come
    back in a single round trip because the page draws seven tabs and seven
    calls would be seven HTTPS hops to the Management API.
  */
  my_tasks: {
    fn: 'my_tasks',
    office: true,
    oneOf: {
      param: 'id',
      arg: 'p_bucket',
      values: ['today', 'overdue', 'upcoming', 'inbox', 'unscheduled', 'done', 'all'],
    },
    /*
      Search and sort (#259, migration 0504). Both optional, and the search
      NARROWS the bucket rather than replacing it — "what am I late on about
      the pricing" is a question, and a search that discarded "overdue" could
      not answer it.
    */
    also: [
      { arg: 'p_query', param: 'q' },
      { arg: 'p_sort', param: 'sort', values: ['smart', 'priority', 'title', 'created'] },
    ],
  },
  my_task_counts: { fn: 'my_tasks_counts', office: true },
  /*
    How far a job got, and why it stopped (#263).

    Takes a JOB id rather than a project, which is why it is its own section
    and not part of a project payload: the question is asked about one piece of
    work, usually because it is taking longer than expected.

    It returns the steps and the pause, and deliberately nothing about
    reasoning — the Issue says "do not expose private reasoning traces" and the
    function that serves this holds none.
  */
  job_progress: { fn: 'job_progress', office: true, arg: 'p_job' },
  /*
    Every trigger and how it is doing (#264).

    `declined` is shown beside `fired` on purpose: a trigger that has fired
    twice and declined ninety times is either working exactly as designed or
    badly misconfigured, and only both numbers can tell them apart.
  */
  triggers: { fn: 'trigger_health', office: true },
  /*
    Registered providers, what they offer, and what of that is USABLE (#265).

    Three separate numbers on purpose: a provider can advertise forty tools,
    the office can offer six, and none of them be reachable until Grant
    approves. Showing only what was offered would read as reach.
  */
  connectors: { fn: 'mcp_inventory', office: true },
  /*
    The sessions a project has with sites the office is signed in to (#135).

    Sessions, not browsers. What comes back says whether there IS a credential
    and never anything about it — a page that could distinguish "a jar is
    stored" from "and here is a bit of it" would make every screenshot of the
    Browser tab a leak.
  */
  browser_sessions: { fn: 'browser_sessions_for', office: true, arg: 'p_project' },
  /*
    What the office has actually opened, most recent first (#135).

    Harness traffic is already excluded by the reader, which is the sixth time
    this repository has had to arrange that and the first time it was arranged
    before anybody saw a suite's rows on a real page.
  */
  browser_lately: { fn: 'browser_lately', office: true, arg: 'p_project', args: { p_limit: 30 } },
  /*
    The present tense (#135).

    Everything else on the Browser tab is past tense — sites it has a session
    for, and pages it already read. Grant asked to SEE the browser, and what it
    is doing this second appeared nowhere on the surface built to show it.
  */
  browser_now: { fn: 'browser_now', office: true, arg: 'p_project' },
  /*
    What is left of today's ten free browser-minutes (#16).

    Global rather than project-scoped, because the cap is. Shown beside the
    sessions so the answer to "why did it not open anything" is on the same
    screen as the question.
  */
  browser_budget: { fn: 'browser_budget', office: true },
  /*
    Where this month's GitHub Actions minutes went (#17).

    Global, like the ceiling. Grant's own words after the incident were that
    1,800 of 2,000 minutes went to a cron nobody was watching, so the reason
    for each run is on every row: a ledger that says only "ci" three hundred
    times answers nothing in three months.
  */
  ci_lately: { fn: 'ci_lately', args: { p_limit: 20 } },
  ci_budget: { fn: 'ci_budget' },
  /*
    Search inside things (#37, migration 0308).

    The command bar already searches TITLES client-side, over the payload the
    page holds — instantly, which is what makes it good. This is the other
    half: the words inside documents and inside answers the team wrote, which
    the page cannot hold and could not reach, because `app.search_documents`
    had no public wrapper and PostgREST exposes only `public`.

    The first section to take a TEXT argument. `arg` has meant "a UUID" since
    `document` introduced it; `textArg` is the same idea with a different
    shape, kept separate so a section cannot be talked into accepting free text
    where an id belongs.
  */
  search: {
    fn: 'studio_search',
    office: true,
    args: { p_limit: 12 },
    textArg: { param: 'q', arg: 'p_query' },
    scoped: true,
    // #37's filters (0397). Composed from named query parameters into the one
    // jsonb the RPC takes — translation, which is all §5 permits an adapter.
    filtered: true,
  },
  /*
    ONE SEARCH OVER EVERY STORE A PROJECT HAS (migration 0921).

    `search` (above) finds documents and the team's answers. This finds those plus tasks, the project conversation,
    saved webpages, Post-its, calendar events and the team's research, as typed rows
    `{kind, id, title, snippet, project_slug, url_hint, score, at}`. `?project=<uuid>` scopes it, `?kinds=task,page`
    narrows it. The office is the verified session's; a project of another office answers like one that does not
    exist.
  */
  project_search: {
    fn: 'project_search',
    office: true,
    args: { p_limit: 20 },
    textArg: { param: 'q', arg: 'p_query' },
    scoped: true,
    also: [{ param: 'kinds', arg: 'p_kinds' }],
  },
  /*
    THE HOUSE STYLE (migration 0923). `?slug=<project>` returns the profile RESOLVED for that project - the office's
    default with the project's fields laid over it, each field saying which it came from - and `vocabulary`, the
    fonts, colours and treatments a profile may use. No `slug` is the office default alone.
  */
  style: {
    fn: 'hq_style_get',
    office: true,
    also: [{ param: 'slug', arg: 'p_slug' }],
  },
  // Which kinds that search can serve in THIS database (calendar needs 0897) - the page draws only filters that find something.
  project_search_providers: { fn: 'project_search_providers', office: true },
  /*
    Everything an object relates to, both directions (#29, migrations 0310-11).

    Takes two arguments where every other section takes at most one, so it uses
    `arg` for the id and `textArg` for the kind — the kind is a short word from
    a fixed vocabulary, and the RPC's own CHECK constraint is what validates it
    rather than a second copy of the list here.
  */
  relations: {
    fn: 'relations_of',
    office: true,
    arg: 'p_id',
    textArg: { param: 'kind', arg: 'p_kind' },
  },
  /*
    HOW A PROJECT GOT HERE (#156, migrations 0401-0402).

    Its own section rather than another array on the studio payload: a project
    built over months has hundreds of entries and every project would carry
    its whole history on every page load, for a panel most visits never open.
    `documents` and `plane` are lazy for the same reason.
  */
  history: { fn: 'project_history', office: true, arg: 'p_project' },
  /** The named actions, so no page hard-codes them (#27). */
  actions: { fn: 'asset_actions' },
  /*
    How the home screen is arranged (#219, migration 0376).

    Its own section rather than a field on `studio`, because it is read once on
    the way in and written whenever a panel moves - and folding it into the
    payload every project switch carries would make a drag on the home board a
    reason to re-read every project.
  */
  workspace: { fn: 'hq_workspace_layout', office: true },
  /*
    Whether the office can think at all (#240, migration 0372).

    `office_health()` has carried `cannot_think` since 0372 - the providers
    whose breaker is open, since when, when they will next be probed and what
    the provider said - and nothing has ever rendered it. While it was true,
    eighteen jobs failed in thirty minutes and the dashboard had nothing to say
    about why.

    Its own section rather than a field on `studio`, for the reason the
    workspace layout has one: this is read on a tick and the studio payload is
    read on a project switch, and folding a fast-moving operational fact into a
    slow-moving structural one means re-reading every project to find out
    whether the model provider is answering.
  */
  // Only the one key the page draws (migration 1028): the whole health reading cost a job census on every tick for a handful of rows.
  thinking: { fn: 'cannot_think', office: true },
  /*
    Project Settings (#36, migrations 0323-26).

    Three sections rather than one, and not for tidiness: each is a different
    tab of the sheet, each is read only when that tab is opened, and the export
    is a third of a megabyte on a real project. Folding them into `studio`
    would make every first paint carry a settings screen nobody has opened, and
    make every project switch carry an export.
  */
  /*
    The project as a graph the dashboard can draw (#25, 0378).

    A section of its own rather than a field on the big studio payload: it is
    four queries and a set of derived edges, and it is wanted only when the map
    is on screen. Putting it in the payload would make every page load pay for
    a screen nobody may open.
  */
  // What has arrived on each project since he last opened it (#122, 0381).
  unseen: { fn: 'studio_unseen', office: true },
  // What each agent has actually done lately (#155, 0385).
  team_work: { fn: 'studio_team_work', office: true },
  plane: { fn: 'studio_plane', office: true, arg: 'p_project_id' },
  plane_layout: { fn: 'hq_plane_layout', office: true, arg: 'p_project_id' },
  project_team: { fn: 'project_team', office: true, arg: 'p_project_id' },
  /*
    A project's calendar (0897): its own events plus the Google events filed under it (scope=project), every project's
    (scope=all), or the whole Google cache including what no project has claimed (scope=google).
    ?project=<slug> (or ?p_slug=) names the project and is needed only for scope=project; ?from= and ?to= bound the window
    (dates or timestamps; the function refuses a bad one, a window over 400 days, and an unknown scope by name).
  */
  project_events: {
    fn: 'hq_project_events',
    office: true,
    also: [
      { param: 'project', arg: 'p_slug' },
      { param: 'p_slug', arg: 'p_slug' },
      { param: 'from', arg: 'p_from' },
      { param: 'to', arg: 'p_to' },
      { param: 'scope', arg: 'p_scope', values: ['project', 'all', 'google'] },
    ],
  },
  /*
    What the web gave a project, and where each piece came from (0930). One entry per saved page or downloaded file with its
    address, title, retrieval time, the agent and job that fetched it, the research task and question, how it was reached
    (search rank or the page whose link led to it), whether it is indexed, a screenshot if one was taken, and which outputs
    cite it. ?project=<slug> (or ?p_slug=) is required; ?limit= bounds the list (default 100, at most 500). Harness
    traffic is excluded by the reader, not here.
  */
  web_sources: {
    fn: 'hq_project_sources_web',
    office: true,
    also: [
      { param: 'project', arg: 'p_slug' },
      { param: 'p_slug', arg: 'p_slug' },
      { param: 'limit', arg: 'p_limit' },
    ],
  },
  project_automations: { fn: 'project_automations', office: true, arg: 'p_project_id' },
  /*
    The whole project, as the neutral package §13 names.

    Deliberately its own section and never part of another: 338KB for Legacy
    Coaching Course today, and it grows with the corpus. It is fetched when
    Grant presses Export and at no other time.
  */
  project_export: { fn: 'project_export', office: true, arg: 'p_project_id' },
  /*
    How a turn the team was given is getting on (0874). The chat follows the job it was handed and shows exactly this.
    One office, one job; a job that is not this office's answers as one that does not exist.
  */
  turn_status: { fn: 'turn_status', office: true, arg: 'p_job' },
}

/**
 * The things the page may CHANGE, as opposed to read.
 *
 * Team HQ is read-only because a dashboard where you can do something
 * irreversible by accident is worse than one where you can do nothing. That
 * reasoning is about *acting* — cancelling a job, approving an output — and not
 * about *configuring*. Attaching a Notion database is a row; detaching it is
 * another row; neither loses anything, because the corpus a connector fed
 * survives the connector being removed (ADR-0013).
 *
 * So configuration is writable and action stays read-only, and the line
 * between them is this list. Deleting a project is deliberately absent: it
 * cascades to documents, and the rule is that a route may be closed and a
 * corpus is kept.
 */
/*
  `by` names the argument that carries WHO IS ANSWERING (0608). It is filled in
  here, from the credential this gateway verified, and any value the client
  sent under that name is discarded: identity is a fact the gateway knows and
  the browser only claims. An action that records authority and has no `by`
  is the gap this exists to close.
*/
/**
 * `by` carries the verified principal into the function for EVERY credential (a function that decides, so the database
 * refuses a principal that is not a person). `personBy` carries it ONLY for a person and removes whatever else was
 * sent: it is for an action the office key may also do (a machine making a test project) where the person's identity
 * adds provenance and its absence adds nothing - a machine never makes a project that counts as a person's.
 */
type ActionSpec = {
  fn: string
  required: readonly string[]
  by?: string
  personBy?: string
  /** The function takes `p_office` first; the gateway writes the verified one (P3). */
  office?: true
}
const ACTIONS: Readonly<Record<string, ActionSpec>> = {
  // `p_force` is optional and deliberately not required: without it the RPC
  // returns the candidates and creates nothing (0153), which is the behaviour
  // every caller should get by default. Passing it is a person having looked at
  // those candidates and said "no, a new one".
  // `personBy`: a project a PERSON made records who (0643), so its channel is part of what was asked. The office key
  // may still make a test project; it carries no principal and so records nothing.
  create_project: {
    fn: 'hq_create_project',
    office: true,
    required: ['p_name', 'p_connector', 'p_ref'],
    personBy: 'p_by',
  },
  rename_project: { fn: 'hq_rename_project', office: true, required: ['p_slug', 'p_name'] },
  // The house style (0923). `p_slug` absent writes the OFFICE default. The channel is the door's fact and is written by
  // the database wrapper ('teamhq'), never sent. `personBy` records who; the office key is a machine and styles nothing.
  style_set: { fn: 'hq_style_set', office: true, required: ['p_patch'], personBy: 'p_by' },
  style_clear: { fn: 'hq_style_clear', office: true, required: [], personBy: 'p_by' },
  /*
    "I love this report. Save this as this project's report style." (0970). Copies the style a MADE report was recorded
    with into the project's profile. Nothing is extracted from the PDF. It asks first when the project already has a
    style (`needs_confirmation`; sent again with `p_confirm: true` it replaces), says so and does nothing for a report
    made before its style was recorded, and is a person's press only - the office key is a machine and styles nothing.
  */
  style_adopt_from_document: {
    fn: 'hq_style_adopt_from_document',
    office: true,
    required: ['p_slug', 'p_document'],
    personBy: 'p_by',
  },
  // A person connecting their OWN Telegram (#410, 0885). The office is the verified session's; the office key is not in
  // SERVICE_MAY, so a machine cannot start or end a person's connection.
  channel_link_begin: { fn: 'channel_link_begin', office: true, required: ['p_channel'] },
  channel_link_disconnect: { fn: 'channel_link_disconnect', office: true, required: ['p_channel'] },
  // A person installing Slack into their OWN workspace (ADR-0065, 0891). Both are handled in the gateway's own branch below
  // (the link is composed here; the bot token is revoked here), so `fn` names the database half. Not in SERVICE_MAY.
  slack_link_begin: { fn: 'slack_link_begin', office: true, required: [] },
  slack_link_disconnect: { fn: 'slack_link_disconnect', office: true, required: [] },
  // `by`: connecting a Notion database is the yes to writing into it, and only a person's connecting counts (0641).
  attach: {
    fn: 'hq_attach',
    office: true,
    required: ['p_slug', 'p_connector', 'p_ref'],
    by: 'p_by',
  },
  detach: { fn: 'hq_detach', office: true, required: ['p_attachment_id'] },
  // Recording that a project deliberately has no Notion page — §3's fifth
  // option, and the only one that does not end in an attachment. `p_reason` is
  // optional because "not now" is a complete answer on its own.
  connection_choose: {
    fn: 'hq_connection_choose',
    office: true,
    required: ['p_slug', 'p_connector', 'p_choice'],
  },
  // One setter over an allow-list of six keys, enforced in the function rather
  // than here — the page is not the only thing that could call this, and a
  // guard in the caller is a guard in one of the callers.
  set_setting: { fn: 'hq_set_setting', required: ['p_key', 'p_value'] },
  /*
    Send it again (#202).

    Takes a JOB, not a delivery, because that is the vocabulary the thread has
    — a message in the conversation is an output and an output knows its job.
    Only the FAILED deliveries of that job are queued, so a retry of an answer
    that reached Telegram and not Slack does not send the Telegram one twice;
    the idempotency is #195's and is used rather than restated.
  */
  retry_send: { fn: 'retry_job_deliveries', office: true, required: ['p_job_id'] },
  // Editing a person, and retiring one. There is no delete and there will not
  // be: outputs, routing decisions and deliveries all name a staff member, and
  // a roster that can lose a row is a history that stops explaining itself.
  staff_update: { fn: 'hq_staff_update', required: ['p_slug'] },
  // Withdrawing a written-down procedure (#50). On the configuring side of the
  // line: `skills` is append-only, so this writes a retirement row rather than
  // removing anything, and writing the procedure again undoes it. `p_reason` is
  // optional — the RPC supplies an honest default rather than an empty string.
  retire_skill: { fn: 'hq_retire_skill', office: true, required: ['p_skill_id'] },
  // How much the office does without asking (#15). Its own action rather than a
  // `set_setting` key: it lives in `autonomy_settings`, it is scoped — a project
  // can override the global — and every change is a new row so "when did it
  // start acting on its own" stays answerable.
  autonomy_set: { fn: 'hq_autonomy_set', office: true, required: ['p_level'], by: 'p_by' },
  /*
    Answering the office when it asks for a capability (ADR-0018, #272).

    `tool_requests` is where an agent that hit the same wall three times asks
    for reach, and `public.hq_approve_tool` / `public.hq_decline_tool` are the
    wrappers written for this page. Neither had a caller anywhere outside
    `scripts/` until now, so every approval on record was made by a script
    rather than by the person the request was addressed to -- which is
    CLAUDE.md's standing complaint about a capability that exists only as a
    script.

    `p_limits` and `p_reason` are both optional and deliberately so: an
    unconditional yes is a complete answer, and so is a no with nothing to add.
    Neither wrapper takes a `p_by` -- the function hardcodes 'grant', because
    this endpoint is behind the bearer token and there is exactly one person
    holding it.

    Revoking is the same governance ledger read backwards, and is NOT the same
    as `staff_tool_set(granted=false)`: that sets a per-person grant, this
    records a withdrawal against the request that earned it.
  */
  /*
    Saying "do not ask me about this again", and taking it back (#15).

    `p_project` is optional and its absence is meaningful: no project means
    everywhere, which is the WIDER scope, so the page always sends one and the
    default exists for a caller that genuinely means everywhere. `p_until` is
    optional because most standing authorizations are not meant to expire.

    Neither takes a `p_by`. The wrapper hardcodes 'grant' exactly as
    `hq_approve_tool` does — an agent cannot widen its own permissions because
    there is no argument through which to try.
  */
  grant_standing: {
    fn: 'hq_grant_standing',
    office: true,
    required: ['p_tool', 'p_reason'],
    by: 'p_by',
  },
  revoke_standing: {
    fn: 'hq_revoke_standing',
    office: true,
    required: ['p_authorization'],
    by: 'p_by',
  },
  /*
    Registering and disconnecting an outside provider (#265).

    Deliberately NOT an action for enabling a discovered tool. Offering one
    makes a switched-off capability; switching it on is the existing approval
    path, which already has its own action and its own record. A second door
    to the same decision is how the invariant erodes.
  */
  register_connector: {
    fn: 'register_mcp_provider',
    office: true,
    required: ['p_name', 'p_endpoint'],
  },
  /*
    Establishing a signed-in session for a project (#135).

    The jar arrives in the body and goes straight into `app.store_secret`
    inside one SQL function. It is never held here, never logged and never
    returned: what comes back is a session id and a site. That is why the
    action is a thin pass-through rather than three steps in TypeScript.
  */
  browser_session_establish: {
    fn: 'browser_session_establish',
    office: true,
    required: ['p_project', 'p_site', 'p_purpose', 'p_jar'],
  },
  /*
    Forgetting one. Removes the Vault row as well as the reference, in that
    order, because a dangling reference is worse than a missing credential
    (0350 took down every job in the building).
  */
  browser_session_forget: {
    fn: 'browser_session_forget',
    office: true,
    required: ['p_session'],
  },
  /*
    Stop. A column the runner reads between steps, not a socket.
  */
  stop_job: { fn: 'request_stop', office: true, required: ['p_job'], by: 'p_who' },
  revoke_connector: { fn: 'revoke_mcp_provider', office: true, required: ['p_provider'] },
  offer_connector_tool: { fn: 'offer_mcp_tool', office: true, required: ['p_discovered'] },
  approve_tool: { fn: 'hq_approve_tool', office: true, required: ['p_request_id'], by: 'p_by' },
  decline_tool: { fn: 'hq_decline_tool', office: true, required: ['p_request_id'], by: 'p_by' },
  revoke_tool: { fn: 'hq_revoke_tool', office: true, required: ['p_slug', 'p_tool'], by: 'p_by' },
  // Per-person tool grants. Never a way past tool_permissions: the RPC ANDs
  // the two, and refuses a grant for a globally disabled tool (§11).
  staff_tool_set: {
    fn: 'hq_staff_tool_set',
    office: true,
    required: ['p_slug', 'p_tool', 'p_granted'],
    by: 'p_by',
  },
  // Hand a bot to someone, or back to the pool. `p_staff_slug` is optional
  // BECAUSE null is the meaningful value — it is how a bot is freed.
  bot_assign: { fn: 'hq_bot_assign', required: ['p_username'] },
  staff_retire: { fn: 'hq_staff_retire', required: ['p_slug', 'p_active'] },
  /*
    Tasks (#11, migrations 0238-0239).

    `public.tasks` has had a good schema for weeks and ZERO ROWS, because
    nothing anywhere could write one — no RPC, no action here, no control in
    the interface. The checkbox in the Tasks section ticked a Set in browser
    memory that was gone on the next render.

    Found while building Calendar sync (#94), whose whole job is putting dated
    tasks in a diary: the plan query correctly returned nothing to do.
  */
  /*
    `p_project` stays required and may now be an EMPTY STRING, which means the
    task belongs to no dashboard project (#173, migration 0281). Required
    rather than optional deliberately: omitting it would make "I forgot to say
    which project" and "this belongs to none" the same request, and only one of
    those should file a task where Grant is not looking.
  */
  task_add: { fn: 'hq_task_add', office: true, required: ['p_project', 'p_title'] },
  // Contacts (#24, #99). A name and a project; everything else — role, org,
  // email, phone, Instagram, website, kind, note — is optional, because a form
  // that demands nine fields before it will take "Ben, referrer" is a form
  // people route around.
  contact_add: { fn: 'hq_contact_add', office: true, required: ['p_project', 'p_name'] },
  /*
    Labels Grant defines, and fields he adds (#110, migration 0285).

    The last two things the studio kept in `localStorage`, and ADR-0021 is why
    they moved: he uses more than one device, and a label he invented on the
    laptop was not there on the phone.

    `p_hue` is optional — omitting it takes the next colour in the ring, which
    is what the page did and what makes two labels made in a row look
    different. `contact_labels_set` and `contact_fields_set` each replace the
    WHOLE value rather than applying a delta: 0250's shape for `p_panels`, and
    right for the same reasons — idempotent, exactly invertible for #118's
    undo, and impossible to half-apply. §5 still holds; the RPC validates every
    entry and writes nothing if one is malformed.
  */
  /*
    Correcting one (0534).

    Grant: *"If information about a contact is displayed as user-managed
    contact data, there should be a sensible way to edit it."* There was one
    door onto this table and it only created. Only the id is required: every
    other argument is null-means-leave-it-alone, so a caller changing one note
    sends one field.
  */
  contact_update: { fn: 'hq_contact_update', office: true, required: ['p_contact_id'] },
  contact_archive: { fn: 'hq_contact_archive', office: true, required: ['p_contact_id'] },
  /*
    Registered here as well as handled above, because the dispatcher checks
    this map BEFORE anything else runs - an action missing from it is
    "unknown action" however complete its handler is. `document_upload` is the
    precedent and it is listed for the same reason: the storage half happens
    before the RPC, and the RPC named here is the one the handler ends in.
  */
  contact_photo: {
    fn: 'hq_contact_photo_set',
    office: true,
    required: ['p_contact_id', 'p_project_id'],
  },
  /*
    PICKING A FILE OUT OF DRIVE.

    A reference, not a copy: the office records which file it is and where it
    lives, and Drive goes on holding it. `hq_document_link` (0535) is the
    canonical writer and picking the same file twice is one document, because
    the index says so.
  */
  /*
    CONNECTING GOOGLE starts here, not at a bare link (0648). The page asks for a one-time state - minted only
    for a verified operator - and carries it through Google's consent screen to the callback, which refuses a
    code that arrives without one. Without it the callback would store whatever account's code it was handed.
  */
  google_connect_start: { fn: 'hq_google_connect_start', required: [], by: 'p_by' },
  drive_link: {
    fn: 'hq_document_link',
    office: true,
    required: ['p_project_id', 'p_external_ref', 'p_title'],
  },
  contact_label_add: { fn: 'hq_contact_label_add', office: true, required: ['p_name'] },
  contact_label_rename: {
    fn: 'hq_contact_label_rename',
    office: true,
    required: ['p_label_id', 'p_name'],
  },
  contact_label_remove: { fn: 'hq_contact_label_remove', office: true, required: ['p_label_id'] },
  contact_labels_set: {
    fn: 'hq_contact_labels_set',
    office: true,
    required: ['p_contact_id', 'p_labels'],
  },
  contact_fields_set: {
    fn: 'hq_contact_fields_set',
    office: true,
    required: ['p_contact_id', 'p_fields'],
  },
  /*
    Answering a blocker, wherever you are standing (#151, migration 0289).

    The landing page has shown "2 things waiting on you" since 0240 and a
    project never did, so the one urgent category was visible exactly where
    Grant could not act on it. There was also no way to ANSWER one from
    anywhere: `answer_generation_approval` did one kind and every other blocker
    could only be discussed.

    The RPC refuses an answer the blocker did not offer — §5, the page
    translates and the RPC decides — because an answer the handler cannot act on
    would resolve the row and strand the job, which is the worst outcome
    available: the interface would report success.
  */
  answer_blocker: {
    fn: 'hq_answer_blocker',
    office: true,
    required: ['p_blocker_id', 'p_answer'],
    by: 'p_by',
  },
  withdraw_refusal: {
    fn: 'hq_withdraw_refusal',
    office: true,
    required: ['p_blocker_id'],
    by: 'p_by',
  },
  // `p_reason` is optional here and required by the RPC when the state is
  // `blocked` — the schema's own check constraint, said in a sentence.
  task_state: { fn: 'hq_task_state', office: true, required: ['p_task_id', 'p_state'], by: 'p_by' },
  /*
    The arrangement of a project's dashboard (#81, migration 0250).

    Configuration, squarely -- it changes what a page looks like and nothing
    the office does. It is here rather than in `localStorage` because Grant
    was explicit: he uses more than one device, and the whole point of
    arranging a dashboard is that it stays arranged.

    `p_panels` is the only jsonb argument any action takes. The RPC validates
    its shape and writes nothing if a single entry is malformed -- a
    half-saved layout is worse than an unsaved one -- so this list does not
    try to check it here. §5: the page translates, the RPC decides.
  */
  dashboard_layout_set: {
    fn: 'hq_dashboard_layout_set',
    office: true,
    required: ['p_slug', 'p_panels'],
  },
  /*
    The order Grant put a project's documents in (§§29-31). A list of ids
    rather than a position per document, so "the order he chose" and "the order
    they arrived in" stay two different facts.
  */
  /*
    A project's calendar (0897). A person's own acts: none is in SERVICE_MAY, so the office key (a machine) is refused.
    The channel the act came from rides in `p_channel` (default teamhq) and is kept on the event and in Activity.
    Google follows by itself: the calendar.sync_events duty pushes what is pending, and an agent's proposal asks the
    approval policy first. Deleting an event already in Google tombstones it until the deletion has reached Google.
  */
  event_add: {
    fn: 'hq_event_add',
    office: true,
    required: ['p_slug', 'p_title', 'p_starts_at'],
  },
  event_update: { fn: 'hq_event_update', office: true, required: ['p_event'] },
  event_delete: { fn: 'hq_event_delete', office: true, required: ['p_event'] },
  // Filing an EXISTING Google event under a project; the event stays Google's.
  event_assign: {
    fn: 'hq_event_assign',
    office: true,
    required: ['p_calendar_id', 'p_event_id', 'p_slug'],
  },
  event_unassign: {
    fn: 'hq_event_unassign',
    office: true,
    required: ['p_calendar_id', 'p_event_id'],
  },
  document_order_set: { fn: 'hq_document_order_set', office: true, required: ['p_slug', 'p_ids'] },
  document_order_reset: { fn: 'hq_document_order_reset', office: true, required: ['p_slug'] },
  dashboard_layout_reset: { fn: 'hq_dashboard_layout_reset', office: true, required: ['p_slug'] },
  /*
    And the home screen's own (#219, migration 0376).

    Same argument as the pair above, one scope up. Grant asked for the homepage
    to use "the same modular dashboard philosophy as project pages", persistence
    included, and 0250's sentence about more than one device is truest about the
    screen he lands on.

    No slug: there is exactly one home screen, keyed on the person. A nullable
    project on the existing table would have been the obvious move and is the
    one CLAUDE.md warns about - two NULLs are distinct in a unique index, so the
    conflict target would have stopped constraining anything for precisely these
    rows.
  */
  workspace_layout_set: { fn: 'hq_workspace_layout_set', office: true, required: ['p_panels'] },
  workspace_layout_reset: { fn: 'hq_workspace_layout_reset', office: true, required: [] },
  // Bringing someone in (0233). The other half of `staff_retire`, which has
  // existed alone since 0079 — the studio had a "+ Bring someone in" button
  // wired to nothing at all.
  //
  // `p_justification` and `p_expires_at` are required HERE as well as in the
  // RPC, which is not belt and braces: this list is what the page is allowed
  // to call, and a hire that reaches the function without a reason or an end
  // should be refused before it costs a round trip. The function refuses it
  // too, because the page is not the only possible caller.
  staff_hire: {
    fn: 'hq_staff_hire',
    required: ['p_name', 'p_title', 'p_justification', 'p_expires_at'],
  },
  // Write-only by construction: there is no matching section that reads it
  // back, and `hq_google` reports only whether one exists.
  // Where he dragged the cards, and how far he zoomed (#25, 0380).
  plane_layout_set: {
    fn: 'hq_plane_layout_set',
    office: true,
    required: ['p_project_id', 'p_at', 'p_view'],
  },
  plane_layout_reset: { fn: 'hq_plane_layout_reset', office: true, required: ['p_project_id'] },
  project_seen: { fn: 'hq_project_seen', office: true, required: ['p_project_id'] },
  /*
    A document is a row you can edit, not only one you can read (#152).

    The same idiom as the task writes: the previous value is captured in the
    function, the reversal is registered with `undo_offer`, and the undo id
    comes back in the result — so `act`'s one chokepoint offers the strip and no
    button here has to know that undo exists.
  */
  /*
    Rename is NOT here: `document_rename` already existed, below, calling
    `rename_document`. 0383 gave that one the undo the issue asks for rather
    than adding a second function that writes the same column — which is the
    trap this repository has recorded twice.
  */
  document_move: {
    fn: 'hq_document_move',
    office: true,
    required: ['p_document_id', 'p_project_id'],
  },
  document_supersede: {
    fn: 'hq_document_supersede',
    office: true,
    required: ['p_document_id', 'p_by_document_id'],
  },
  // `p_state` optional: an undo carries the state the document was in, and a
  // press of "this one is current again" carries nothing and means approved.
  document_restore: { fn: 'hq_document_restore', office: true, required: ['p_document_id'] },
  document_pin: { fn: 'hq_document_pin', office: true, required: ['p_document_id', 'p_pinned'] },
  /*
    VERSIONS AND IMPORT (0900). All three are a person's explicit press: none is on SERVICE_MAY, so the office key
    (a machine) is refused, and nothing in the product calls them but this page.
    - document_new_version: the next version from new text (`p_content`) OR by adopting an existing approved document in
      the same project (`p_by_document_id`). `p_approve` approves a draft being adopted. The old one is archived, never
      deleted.
    - document_rollback: make an older version current by writing it as a NEW version.
    - document_import: make the durable Team HQ copy of an external document (or record the request when the text is not
      held yet). Never silent: this is the only caller.
  */
  document_new_version: {
    fn: 'hq_document_new_version',
    office: true,
    required: ['p_document_id'],
  },
  document_rollback: { fn: 'hq_document_rollback', office: true, required: ['p_document_id'] },
  document_import: { fn: 'hq_document_import', office: true, required: ['p_document_id'] },
  /*
    Handled above rather than dispatched, because it carries bytes (#126). It
    is listed here so the whitelist is still the one place that says which
    actions exist, and so an unknown-action error names it.
  */
  document_upload: {
    fn: 'record_file_document',
    office: true,
    required: ['p_project_id', 'p_name', 'p_base64'],
  },
  set_google_secret: { fn: 'hq_set_google_secret', required: ['p_secret'] },
  /*
    Both Google values at once (§35, 0377).

    The page used to send the ID through `set_setting` and the secret through
    `set_google_secret`, which meant nothing could tell that the two had been
    typed into each other's boxes — and the ID is stored in plain text and
    rendered back into the form, so that mistake printed a live secret on the
    Settings page. One call sorts them by shape, the way 0359 already does for
    Slack. Both are required by name and either may be empty.
  */
  set_google_credentials: {
    fn: 'hq_set_google_credentials',
    required: ['p_client_id', 'p_secret'],
  },
  // #210. Both halves together: a bot token without a signing secret can post
  // and cannot verify anything inbound, which reads as connected and is half a
  // connection. Reinstalling produces both at the same moment.
  set_slack_credentials: {
    fn: 'hq_set_slack_credentials',
    office: true,
    required: ['p_bot_token', 'p_signing_secret'],
  },
  // The way back out. There was a way in and none out, which made a consent
  // granted through a browser effectively permanent from this page's side.
  forget_google: { fn: 'hq_forget_google', office: true, required: [] },
  /*
    Disconnecting anything (#90, migration 0252).

    `forget_google` stays, because the Setting up page calls it by name and a
    working caller is not worth breaking; this is the general one, and Google
    is one of its branches.

    The RPC decides what disconnecting each service means AND which ones have
    no honest disconnect at all — OpenRouter is how the team thinks, Telegram
    is how it reaches him. It returns a refusal with the reason rather than a
    cheerful ok, and this list does not second-guess it. §5.
  */
  disconnect: { fn: 'hq_disconnect', office: true, required: ['p_service'] },
  /*
    How a dashboard project looks (#83, migration 0253).

    Only the slug is required: every other argument is an edit, and `p_clear`
    is how a caller says "remove this" — null cannot mean both "leave it" and
    "take it away". The image arrives as a data URL already resized to 256px by
    the page; the RPC caps it at 96 KB, which can only be exceeded if that
    resize did not run and is worth refusing loudly rather than storing.
  */
  project_look: { fn: 'hq_project_look', office: true, required: ['p_slug'] },
  /*
    Editing a task (#106, migration 0255).

    Only the id is required: everything else is an edit, and `p_clear` says
    which fields are being taken away — null cannot mean both "leave this" and
    "remove it", and removing a due date is a normal thing to want.

    `state` is deliberately NOT here. `task_state` owns it, because it also
    maintains `done_at` and enforces the reason a blocked task needs; two
    functions writing one column is how a constraint gets violated by the one
    that forgot.
  */
  task_update: { fn: 'hq_task_update', office: true, required: ['p_task_id'] },
  // One setter over three kinds of routing change, allow-listed inside the
  // function for the same reason `set_setting` is: the page is not the only
  // possible caller.
  routing_set: { fn: 'hq_routing_set', office: true, required: ['p_what', 'p_value'] },
  /*
    Taking something back (#118, migrations 0263-0265).

    Every write above that has an EXACT inverse now records it at the moment it
    still knows the previous value, and answers with an `undo` id. This is the
    action that spends one.

    It is on the configuring side of the line by construction: it can only
    perform a reversal that some other action here already recorded, so it can
    never do anything those actions could not.

    `reattach` is its one companion — the exact inverse of `detach`, which
    re-enables the same row rather than attaching the same reference again. It
    is listed so that undoing a detach goes through the same door as everything
    else rather than through a private one.
  */
  undo: { fn: 'hq_undo', office: true, required: ['p_action_id'] },
  reattach: { fn: 'hq_reattach', office: true, required: ['p_attachment_id'] },
  /*
    Governance (#54, migration 0302).

    `lesson_retract` is on the configuring side of the line by construction:
    `lessons` is append-only (§6), so it writes a RETRACTION row that
    supersedes the lesson rather than removing anything. Nothing is lost and
    the reason is recorded next to it. `p_why` is optional — "no longer true"
    is a complete answer and the RPC supplies an honest default.

    `proposal_decide` approves or declines a proposal in place. The decline is
    the durable half: `proposals_one_per_need` means the same need cannot be
    raised again while the row stands, which is what makes a decline stick
    rather than becoming a nag. Reopening is allowed and is a person's call.
  */
  /*
    Pointing a project at something we cannot log into (#35, migration 0306).

    Only the slug and the link are required: the kind and the title are
    inferred from the URL, because a form with a kind dropdown and a title
    field is three decisions for something Grant pasted in one gesture, and
    §31 calls an avoidable request for manual configuration a design failure.
    Both are still accepted, so a wrong guess is correctable.

    On the configuring side of the line: a reference holds nothing, so adding
    one and removing one both lose nothing. That is exactly why `remove` is a
    real delete here while `detach` only disables — a connector has a corpus
    behind it and ADR-0013 keeps it; a pointer does not.
  */
  /*
    The asset model, reachable (#29, migration 0312).

    Rename, tag and file were a page's private business — `put_in_collection`
    had a public wrapper and was in no section list, so nothing with a browser
    or an agent could reach it, and there was no rename or tag at all. #29 is
    explicit that these must be API-reachable and not frontend-only state.

    Collections are addressed by NAME rather than by id, following
    `put_in_collection`'s own choice: a caller holding a document and the word
    "Research" should not have to look a uuid up first.
  */
  /*
    Send an asset to the team with a NAMED action (#27, migration 0313).

    Only the asset and the verb are required. Who it goes to is optional — with
    nobody named the Chief of Staff takes it, as everywhere else — and so is the
    second asset, which only `compare` needs and the RPC refuses without.
  */
  /*
    Saying something in a project, with no asset attached (#26, #193).

    `send_to_agent` above is the asset path — send THIS document to Emma. This
    is the composer: free text, optionally addressed to one of the team.

    `p_addressed_to` is deliberately not required. Not choosing is a valid way
    to send a message, and #26 says keyword routing stays the fallback when
    Grant does not pick — a composer that forces you to name somebody makes the
    common case the awkward one.
  */
  say: { fn: 'say_in_project', office: true, required: ['p_project_id', 'p_text'], by: 'p_by' },
  send_to_agent: {
    fn: 'send_to_agent',
    office: true,
    required: ['p_kind', 'p_id', 'p_action'],
    by: 'p_by',
  },
  /*
    The import gate (#28, migration 0315).

    "Approving is what moves an artifact into the project", and until now that
    decision lived in `localStorage` — a note in Grant's browser that did not
    survive a different device and that no agent could see. `approve_document`
    had existed with a public wrapper the whole time and nothing called it.

    Only the document is required. A sheet that refuses to submit until four
    fields are filled in is a sheet he closes; approving with nothing chosen
    means "yes, and I have nothing to add".
  */
  /*
    IMPORT TO PROJECT — where an output becomes a document (#28, 0317).

    Only the output is required. The other five are the sheet's fields, and a
    sheet that will not submit until they are all filled in is a sheet Grant
    closes: importing with nothing chosen means "yes, and I have nothing to
    add".
  */
  output_import: { fn: 'import_output', office: true, required: ['p_output'] },
  output_decide: { fn: 'decide_output', office: true, required: ['p_output', 'p_verdict'] },
  document_approve: { fn: 'approve_document', office: true, required: ['p_document'], by: 'p_by' },
  document_discard: { fn: 'discard_document', office: true, required: ['p_document'], by: 'p_by' },
  document_rename: { fn: 'rename_document', office: true, required: ['p_document', 'p_title'] },
  document_tag: { fn: 'tag_document', office: true, required: ['p_document', 'p_tag'] },
  collection_put: {
    fn: 'put_in_collection',
    office: true,
    required: ['p_document', 'p_collection_name'],
  },
  collection_take: {
    fn: 'take_out_of_collection',
    office: true,
    required: ['p_document', 'p_collection_name'],
  },
  reference_add: { fn: 'add_project_reference', office: true, required: ['p_slug', 'p_url'] },
  reference_remove: { fn: 'remove_project_reference', office: true, required: ['p_reference_id'] },
  lesson_retract: { fn: 'retract_lesson', office: true, required: ['p_lesson_id'] },
  /*
    ACCEPT OR DECLINE A DRAFTED STANDING RULE (#147).

    `p_accept` is required rather than defaulted, because a missing boolean
    that defaults to false would turn a dropped field into a silent decline —
    and a decline is not reversible here: `propose_standing_rule` refuses to
    offer a class that has already been answered, so the rule would never be
    put to him again.

    Accepting is the ONLY path by which a correction becomes a rule. Nothing in
    the answering handler stores one.
  */
  suggestion_decide: {
    fn: 'decide_suggestion',
    office: true,
    required: ['p_suggestion_id', 'p_accept'],
  },
  /*
    HOW THE STUDIO LOOKS (#124, migration 0400).

    The whole object at once, because that is how the page holds it and a
    partial write would need this adapter to know which keys exist — which is
    the adapter deciding, and §5 permits it only to translate.

    ADR-0021: localStorage is the cache in front of this and never the record.
  */
  appearance_set: { fn: 'hq_appearance_set', office: true, required: ['p_settings'] },
  proposal_decide: { fn: 'decide_proposal', office: true, required: ['p_proposal_id', 'p_state'] },
  /*
    Project Settings (#36, migrations 0323-26).

    `p_instruction` is required on `project_instruction` and the empty string
    is a legitimate value for it — clearing a brief is a thing Grant does, and
    an optional argument would make "clear it" indistinguishable from "the page
    forgot to send it".

    `automation_create` requires only the project and the sentence. Everything
    else has a default the RPC states in one place: once a day, nobody in
    particular, which is what an automation means when you have not said
    otherwise.

    There is no `project_delete` here and there will not be. Archive is
    reversible and is what this sheet offers; `app.project_delete` exists for a
    person at a terminal who has read ADR-0014, which is not a button.
  */
  project_staff: {
    fn: 'set_project_staff',
    office: true,
    required: ['p_slug', 'p_staff_slug', 'p_on'],
  },
  /*
    `p_instruction` is deliberately NOT required, and it is the only argument in
    this map for which that is true.

    The guard below treats the empty string as missing, which is right for
    every other action it protects and wrong for this one: clearing a brief IS
    sending an empty one, and requiring it made the clear unreachable with
    `missing: p_instruction`. 0327 gave the argument a default of '' so that
    "no brief sent" and "clear the brief" mean the same thing — which is the
    only reading under which both are true.
  */
  project_instruction: {
    fn: 'set_project_instruction',
    office: true,
    required: ['p_slug', 'p_staff_slug'],
  },
  automation_create: {
    fn: 'create_automation',
    office: true,
    required: ['p_slug', 'p_instruction'],
  },
  automation_set: { fn: 'set_automation', office: true, required: ['p_automation', 'p_on'] },
  automation_remove: { fn: 'remove_automation', office: true, required: ['p_automation'] },
  project_archive: { fn: 'archive_project', office: true, required: ['p_slug'] },
  project_unarchive: { fn: 'unarchive_project', office: true, required: ['p_slug'] },
  /*
    And the two writes it needs (#259). Completing and reopening go through
    `task_state`, which already exists and already does both for either kind of
    task — ADR-0041's "one set of writers".
  */
  my_task_add: { fn: 'my_task_add', office: true, required: ['p_title'] },
  my_task_set: { fn: 'my_task_set', office: true, required: ['p_task_id'] },
  /*
    And the two 0513/0514 added, because a task you cannot remove and a
    relationship you cannot make are both features that exist only in the
    schema. `my_task_delete` refuses anything that is not Grant's own, so the
    boundary is enforced in the function rather than by this list being
    careful.
  */
  my_task_delete: { fn: 'my_task_delete', office: true, required: ['p_task_id'] },
  my_task_reparent: { fn: 'my_task_reparent', office: true, required: ['p_task_id'] },
  /*
    Connecting a task provider, and letting it go (#259, Phase 2).

    Three arguments, all required, because a connection with two of them is not
    a connection. The address and the token are sorted BY SHAPE inside
    `hq_set_vikunja` rather than trusted to arrive in the right boxes — 0359
    records what the alternative cost: a live secret pasted into a plaintext
    setting and rendered back onto the Settings page.

    Disconnecting takes the credential with it (0520) and says what it removed,
    so "disconnect" means what the word means.
  */
  vikunja_connect: {
    fn: 'hq_set_vikunja',
    office: true,
    required: ['p_base_url', 'p_project_id', 'p_api_token'],
    // Connecting the board is the yes to create/update on it, and only a person's connecting counts (0641).
    by: 'p_by',
  },
  vikunja_forget: { fn: 'hq_forget_vikunja', office: true, required: [] },
}

/**
 * Constant-time comparison.
 *
 * A dashboard token is guessable by timing in principle and it costs four lines
 * not to be. Both sides are hashed to a fixed width first, because comparing
 * raw strings of different lengths is itself a length oracle — the same
 * reasoning as `src/channels/telegram.ts`.
 */
const tokenMatches = async (presented: string | null): Promise<boolean> => {
  if (HQ_TOKEN === '' || presented === null || presented === '') return false
  const digest = async (v: string): Promise<Uint8Array> =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
  const [a, b] = await Promise.all([digest(presented), digest(HQ_TOKEN)])
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/*
  WHO IS ALLOWED TO ASK, and the two very different answers.

  ## What changed, and what did not

  The bearer token is unchanged. It is still one credential, still compared in
  constant time, still rotated by changing one vault row — and it is still what
  the worker, the deploy probes, the MCP endpoint and every script present. A
  capability is the right shape for a machine.

  What it was ALSO doing was letting a person in, and that is how it reached
  Grant's screen. He asked for it gone from the experience:

    "The normal user should not: see an office token; paste an office token;
     ... understand what an office token is."

  So a second, entirely separate answer is accepted now: a PERSON'S OWN
  SESSION, issued by this project's Supabase Auth, verified here, and checked
  against `public.office_members`.

  ## Why this is not weaker

  Three things have to be true before a session gets in, and none of them is
  something the browser can assert about itself:

    1. Supabase says the token is a live session it issued. Verified by asking
       Supabase, not by reading the JWT — a token this function merely DECODED
       would be a token anybody could write.
    2. The session carries a confirmed email address.
    3. That address is in `public.office_members`, which only the service role
       can even read.

  A stranger who signs up therefore gets a perfectly valid session and is
  refused here, which is the property that makes open signup a nuisance rather
  than a hole.

  ## The cache

  Verification is a network call, and a dashboard load makes several requests.
  Answers are held for a minute, keyed by the token itself — well inside the
  hour a session lasts, and short enough that removing somebody from the
  office takes effect while they are still looking at it. Only POSITIVE answers
  are cached: a refusal must stay cheap to change.
*/
const SESSION_TTL_MS = 60_000

/*
  THE OFFICE THE MACHINE KEY ACTS IN: the test office, and no other. The key names no person (ADR-0054) and no real
  office (P3), so anything it does through an office-explicit function lands in the office harness traffic belongs to.
  Resolved from the database, cached for a minute; a database that cannot answer yields no office and the call is refused.
*/
let machineOfficeHeld: { until: number; office: string } | null = null
const machineOffice = async (): Promise<string | null> => {
  if (machineOfficeHeld !== null && machineOfficeHeld.until > Date.now())
    return machineOfficeHeld.office
  const asked = await askUpstream(`${DB_URL}/rest/v1/rpc/resolve_machine_office`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: '{}',
  })
  if ('unreachable' in asked || !asked.response.ok) return null
  const r = (await asked.response.json().catch(() => ({}))) as { ok?: boolean; office_id?: string }
  if (r.ok !== true || typeof r.office_id !== 'string' || r.office_id === '') return null
  machineOfficeHeld = { until: Date.now() + SESSION_TTL_MS, office: r.office_id }
  return r.office_id
}
/** A verified session, and the owner key of the person it belongs to. */
const seen = new Map<
  string,
  { until: number; owner: string; kind: PrincipalKind; office: string }
>()

const looksLikeSession = (presented: string): boolean =>
  presented.split('.').length === 3 && presented.length > 60

/*
  A THROTTLE IS NOT AN ANSWER, AND NEITHER IS A DROPPED CONNECTION.

  This returned a plain boolean, so every way of failing to ASK collapsed into
  "this session is not valid": a 429 from Supabase Auth under a burst, a 5xx,
  a network blip. The caller then got 401 -- and office.js clears a session the
  office refused, correctly -- so an upstream hiccup SIGNED THE PERSON OUT of
  every device it reached.

  Seen in this repository's own acceptance run: four suites signing in within a
  minute, and the fifth read an office that answered nothing, because the
  verification behind it was being throttled rather than refusing anybody.

  So the three answers are separated. CLAUDE.md states both halves of the rule:
  a throttle is not an answer, and the absence of a "yes" is not the presence
  of a "no". `unknown` grants nothing -- it is answered with 503, which says
  the office could not check rather than that it checked and said no.
*/
type Verdict = 'yes' | 'no' | 'unknown' | 'no_office'

/** One request, retried once on a throttle, because a 429 is a wait. */
const askUpstream = async (
  url: string,
  init: RequestInit,
): Promise<{ response: Response } | { unreachable: true }> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = await fetch(url, init).catch(() => null)
    if (r === null) {
      if (attempt === 0) {
        await new Promise((ok) => setTimeout(ok, 250))
        continue
      }
      return { unreachable: true }
    }
    if (r.status === 429 && attempt === 0) {
      await new Promise((ok) => setTimeout(ok, 400))
      continue
    }
    return { response: r }
  }
  return { unreachable: true }
}

/*
  WHAT KIND OF THING PRESENTED THE CREDENTIAL (#385, 0614).

    person  - a signed-in member of the office, as themselves.
    harness - a signed-in TEST member: a real session that the database lets
              decide only test traffic (app.authority_refusal).
    service - the office key. A machine. It has no name here, on purpose.

  The kind is the gateway's verified fact, never the page's claim, and the office
  key is never a person: possession of a generic credential must not manufacture
  a human's approval identity.
*/
type PrincipalKind = 'person' | 'harness' | 'service'

interface Answer {
  readonly verdict: Verdict
  /** Who this credential is, when it is a verdict of 'yes'. Never a default. */
  readonly principal: string | null
  /** What kind of credential it was, when the verdict is 'yes'. */
  readonly kind: PrincipalKind | null
  /**
    The office the VERIFIED LOGIN belongs to (P3). Resolved from the auth user id, never from a request. A session
    that resolves to no active office is refused ('no_office'); the machine key names none.
  */
  readonly office?: string | null
  /**
    Set only with 'no_office': the session is a VERIFIED login (confirmed address) that no office member matches, so the
    person may open an office of their own (self-service account creation). Never set for a member whose office was
    retired - that is a decision, not a missing step.
  */
  readonly canCreate?: boolean
}

/*
  One resolution at a time per presented credential (efficiency run, October 2026).

  A page load sends about eight reads in parallel with the same token. On a cold isolate none of them found the cache filled,
  so each one made the full three-step resolution (the identity service, the member lookup, the office lookup): twenty-four
  upstream calls to learn the same fact eight times. Concurrent callers of the SAME token now share one resolution. Keyed by
  the whole credential, so one person's answer is never handed to another; the answer is not kept beyond the call (only a 'yes'
  is cached, as before, by resolveSession), and a refusal or a throttle is shared only with the calls that were already waiting.
*/
const resolving = new Map<string, Promise<Answer>>()

const sessionAllowed = (presented: string): Promise<Answer> => {
  const running = resolving.get(presented)
  if (running !== undefined) return running
  const started = resolveSession(presented).finally(() => {
    resolving.delete(presented)
  })
  resolving.set(presented, started)
  return started
}

const resolveSession = async (presented: string): Promise<Answer> => {
  const cached = seen.get(presented)
  if (cached !== undefined && cached.until > Date.now()) {
    return {
      verdict: 'yes',
      principal: cached.owner === '' ? null : cached.owner,
      kind: cached.kind,
      office: cached.office,
    }
  }

  const asking = await askUpstream(`${DB_URL}/auth/v1/user`, {
    headers: {
      apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      Authorization: `Bearer ${presented}`,
    },
  })
  if ('unreachable' in asking) return { verdict: 'unknown', principal: null, kind: null }
  const who = asking.response
  /*
    401 and 403 are the identity service SAYING NO. Anything else that is not
    ok -- 429, 5xx, a gateway error -- is it failing to answer, and the two
    must not be the same word.
  */
  if (!who.ok) {
    return {
      verdict: who.status === 401 || who.status === 403 ? 'no' : 'unknown',
      principal: null,
      kind: null,
    }
  }
  const user = (await who.json().catch(() => ({}))) as {
    id?: string
    email?: string
    email_confirmed_at?: string
  }
  const email = String(user.email ?? '')
    .trim()
    .toLowerCase()
  if (email === '') return { verdict: 'no', principal: null, kind: null }

  const membership = await askUpstream(`${DB_URL}/rest/v1/rpc/office_member`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_email: email }),
  })
  if ('unreachable' in membership) return { verdict: 'unknown', principal: null, kind: null }
  /*
    The membership list is this office's own table. A failure to READ it is
    never evidence that somebody is not on it -- that is exactly the direction
    0304 warns about -- so anything other than a successful answer is unknown.
  */
  if (!membership.response.ok) return { verdict: 'unknown', principal: null, kind: null }
  const rows = (await membership.response.json().catch(() => [])) as {
    ok?: boolean
    owner_key?: string | null
    kind?: string | null
  }[]
  if (rows[0]?.ok !== true) {
    /*
      NOT A MEMBER. A stranger whose address Supabase has CONFIRMED is a real login with no office yet, which is
      answered with a distinct 'no_office' + canCreate (403, so the page keeps the session and offers to create one).
      An unconfirmed address stays refused. Nothing is cached: only a 'yes' is remembered, so the moment the office
      exists the next request resolves it.
    */
    const confirmed = String(user.email_confirmed_at ?? '').trim() !== ''
    return confirmed
      ? { verdict: 'no_office', principal: null, kind: null, canCreate: true }
      : { verdict: 'no', principal: null, kind: null }
  }
  const owner = String(rows[0]?.owner_key ?? '').trim()
  // A member with no owner key is admitted to read and is nobody to answer as.
  const principal = owner === '' ? null : owner
  /*
    A member whose kind the database did not say is treated as a TEST member: the
    restrictive reading. It can read; it cannot be taken for a person. (A database
    that predates 0614 answers no kind at all, and must not make everybody one.)
  */
  const kind: PrincipalKind = rows[0]?.kind === 'person' ? 'person' : 'harness'

  /*
    THE OFFICE comes from the verified auth user id and from nothing the caller said. No office, a disabled one, or an
    ambiguous answer is a refusal - never a default, never Grant. A failure to ASK is unknown, not no (0304).
  */
  const asked = await askUpstream(`${DB_URL}/rest/v1/rpc/resolve_office`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_auth_user_id: String(user.id ?? '') }),
  })
  if ('unreachable' in asked || !asked.response.ok)
    return { verdict: 'unknown', principal: null, kind: null }
  const resolved = (await asked.response.json().catch(() => ({}))) as {
    ok?: boolean
    office_id?: string
  }
  if (resolved.ok !== true || typeof resolved.office_id !== 'string' || resolved.office_id === '')
    return { verdict: 'no_office', principal: null, kind: null }
  const office = resolved.office_id

  seen.set(presented, { until: Date.now() + SESSION_TTL_MS, owner: principal ?? '', kind, office })
  // Bounded, because this map lives as long as the isolate does.
  if (seen.size > 64) for (const k of [...seen.keys()].slice(0, 32)) seen.delete(k)
  return { verdict: 'yes', principal, kind, office }
}

/*
  The bearer token is a MACHINE's credential (CLAUDE.md: "a machine presents a
  key") and it names nobody. Until 0614 this said 'grant', which made every
  holder of the key Grant for every approval, standing authorization, reach
  grant, autonomy change and refusal reversal (#385). It is the kind 'service'
  now, with no principal to write, so a function that needs an answering person
  refuses it by name, and SERVICE_MAY below is the short list of things a
  machine may still do.
*/

/*
  WHAT THE OFFICE KEY MAY DO (#385).

  The key is a machine's, so this is an ALLOW list and the default is no: a new
  action added tomorrow needs a signed-in person until somebody decides
  otherwise. What is here changes data a person owns or the shape of their
  screen; none of it decides anything, speaks as anybody, widens what the office
  may reach or do, holds a credential, connects a source, or answers a question.
  Everything else - answering, approving, declining, granting, revoking,
  setting autonomy, undoing, taking a No back, saying something in a project as
  the person, hiring, connecting, credentials, uploading material as theirs -
  needs a session.
*/
/*
  WHAT ONLY THE DEPLOYMENT'S OPERATOR MAY DO (multi-user P1.3, #400).

  "A person may do everything" was the same thing as "the operator" while the deployment had one human. It
  is not once it has two: a second signed-in person would reach the first one's settings, the Google and Slack
  credential forms, connector registration, the roster and the routing table. These actions change what is
  SHARED by every office, or hold a credential the whole deployment acts through, so they need a person who is
  also named in `deployment_operators` (0647) - asked of the database by owner key, never inferred from a
  name, a header, or a field of the request.

  This is not a role system: one set, one question. Everything per-office stays with any person - their
  projects, tasks, documents, contacts, autonomy dial, standing yeses and lessons - and the test that pins
  this file (tests/gateway/operator-only.test.ts) refuses an action whose name or function looks like a
  deployment-wide change but is in neither this set nor the reasoned exceptions beside it.

  A harness member is never an operator (the database says so even if a row were planted), and the machine
  key is not a person, so Sample and test offices cannot reach any of these by principal-kind confusion.
*/
const OPERATOR_ONLY: ReadonlySet<string> = new Set([
  'set_setting',
  'set_google_secret',
  'set_google_credentials',
  'set_slack_credentials',
  'forget_google',
  'disconnect',
  'vikunja_connect',
  'vikunja_forget',
  'register_connector',
  'revoke_connector',
  'offer_connector_tool',
  'routing_set',
  'bot_assign',
  'staff_hire',
  'staff_update',
  'staff_retire',
  'staff_tool_set',
  // approve_tool, decline_tool and revoke_tool are NOT here: a request for reach is raised in ONE office and is
  // answered by the person that office belongs to. The functions are office-scoped in the database (the request is
  // matched on `office_id = p_office`, the answerer must be that office's own person, and revoking acts on that
  // office's grants), so answering carries no deployment authority. The tool switches that govern every office
  // (`tool_permissions.enabled`) stay the ceiling and are reached only through `set_setting`, which is still here.
  'drive_link',
  'google_connect_start',
])

const operators = new Map<string, number>()
const OPERATOR_TTL_MS = 60_000

/*
  The read-only pages that describe the DEPLOYMENT rather than an office. None carries `office: true` because there is
  nothing to scope them to, so the office boundary never covered them (found by the P4 second-person acceptance).
  tests/gateway/operator-only.test.ts refuses a section whose function takes no office and which is in neither this set
  nor the reasoned list beside it.
*/
const OPERATOR_SECTIONS: ReadonlySet<string> = new Set([
  'google',
  'build',
  'ci_lately',
  'ci_budget',
  'bots',
])

/*
  Asked of the database by owner key. Fails CLOSED: a lookup that does not answer is a refusal, and only a
  positive answer is remembered (for a minute) - a revoked operator must not stay one because a cache said so.
*/
const isOperator = async (owner: string): Promise<boolean> => {
  const held = operators.get(owner)
  if (held !== undefined && held > Date.now()) return true
  const asked = await fetch(`${DB_URL}/rest/v1/rpc/deployment_operator`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_owner_key: owner }),
  }).catch(() => null)
  if (asked === null || !asked.ok) return false
  const answer = await asked.json().catch(() => false)
  if (answer !== true) {
    operators.delete(owner)
    return false
  }
  operators.set(owner, Date.now() + OPERATOR_TTL_MS)
  if (operators.size > 64) for (const k of [...operators.keys()].slice(0, 32)) operators.delete(k)
  return true
}

const MACHINE_FIXTURE_ONLY: ReadonlySet<string> = new Set([
  'create_project',
  'rename_project',
  'project_archive',
  'project_unarchive',
])

const SERVICE_MAY: ReadonlySet<string> = new Set([
  'create_project',
  'rename_project',
  'project_archive',
  'project_unarchive',
  'my_task_add',
  'my_task_set',
  'my_task_delete',
  'my_task_reparent',
  'task_add',
  'task_update',
  'contact_add',
  'contact_update',
  'contact_archive',
  'contact_photo',
  'contact_label_add',
  'contact_label_rename',
  'contact_label_remove',
  'contact_labels_set',
  'contact_fields_set',
  'document_tag',
  'document_rename',
  'document_move',
  'document_supersede',
  'document_restore',
  'document_pin',
  'collection_put',
  'collection_take',
  'stop_job',
  'retry_send',
  'dashboard_layout_set',
  'dashboard_layout_reset',
  'document_order_set',
  'document_order_reset',
  'workspace_layout_set',
  'workspace_layout_reset',
  'plane_layout_set',
  'plane_layout_reset',
  'appearance_set',
  'project_seen',
  'project_look',
])

const allowed = async (presented: string): Promise<Answer> => {
  if (presented === '') return { verdict: 'no', principal: null, kind: null }
  if (await tokenMatches(presented)) return { verdict: 'yes', principal: null, kind: 'service' }
  if (!looksLikeSession(presented)) return { verdict: 'no', principal: null, kind: null }
  return await sessionAllowed(presented)
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // The page is served from Vercel and this from Supabase, so it is
      // cross-origin by construction (ADR-0011: Supabase cannot serve HTML).
      // Wide open is acceptable ONLY because the bearer token is the whole of
      // the authorisation and is never a cookie — there is no ambient
      // credential for another origin to ride on.
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'cache-control': 'no-store',
    },
  })

/*
  AUTHORIZE THE TARGET BEFORE ANYTHING IS WRITTEN (multi-user P1.4, 0650).

  An upload used to build its storage path from the request's own project and contact ids, write the object, and
  only afterwards ask the database whether either was real. The order is the defect: authenticate, then
  authorize the DATABASE target, then write the object. `hq_upload_target` answers with the canonical project
  (read from the row, never from the request) or the SAME refusal for a missing, mismatched or off-limits target.
  Nothing is written to storage unless it says ok, and the path is built from what it returned.
*/
const uploadTarget = async (
  office: string,
  uploadKind: 'contact_photo' | 'document_upload',
  projectId: string,
  contactId: string | null,
  by: string | null,
): Promise<{ projectId: string } | { error: string }> => {
  const asked = await fetch(`${DB_URL}/rest/v1/rpc/hq_upload_target`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      // The verified office: a target is judged inside it (a foreign project and a missing one are the same refusal).
      p_office: office,
      p_kind: uploadKind,
      p_project_id: projectId,
      p_contact_id: contactId,
      p_by: by,
    }),
  }).catch(() => null)
  if (asked === null || !asked.ok) return { error: 'could not check the target' }
  const answer = (await asked.json().catch(() => ({}))) as {
    ok?: boolean
    project_id?: string
    error?: string
  }
  return answer.ok === true && typeof answer.project_id === 'string'
    ? { projectId: answer.project_id }
    : { error: String(answer.error ?? 'no such target') }
}

/*
  SELF-SERVICE ACCOUNT CREATION. One person, one private office.

  Authority is the VERIFIED SESSION and nothing else: the session is checked with Supabase Auth, the address must be
  confirmed, and the database function derives the owner key from the auth id. A machine key is not a session and is
  refused. An id, an email, an owner key or an office in the body is never read. Idempotent in the database (one lock
  per login), so a repeated or concurrent press returns the same office.
*/
const createOffice = async (
  presented: string,
  body: Record<string, unknown>,
): Promise<Response> => {
  if (presented === '' || !looksLikeSession(presented)) return json({ error: 'unauthorized' }, 401)
  const asking = await askUpstream(`${DB_URL}/auth/v1/user`, {
    headers: {
      apikey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      Authorization: `Bearer ${presented}`,
    },
  })
  const couldNot = (): Response =>
    json({ error: 'The office could not check who you are just now. Try again in a moment.' }, 503)
  if ('unreachable' in asking) return couldNot()
  if (!asking.response.ok) {
    return asking.response.status === 401 || asking.response.status === 403
      ? json({ error: 'unauthorized' }, 401)
      : couldNot()
  }
  const user = (await asking.response.json().catch(() => ({}))) as {
    id?: string
    email?: string
    email_confirmed_at?: string
  }
  const authId = String(user.id ?? '')
  const email = String(user.email ?? '')
    .trim()
    .toLowerCase()
  if (authId === '' || email === '') return json({ error: 'unauthorized' }, 401)
  if (String(user.email_confirmed_at ?? '').trim() === '') {
    return json(
      { ok: false, error: 'Please confirm your email address first, then try again.' },
      403,
    )
  }
  const named = body.name ?? (body.args as Record<string, unknown> | undefined)?.name
  const name = typeof named === 'string' ? named.slice(0, 400) : ''
  const made = await askUpstream(`${DB_URL}/rest/v1/rpc/self_provision_office`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ p_auth: authId, p_email: email, p_name: name }),
  })
  if ('unreachable' in made || !made.response.ok) {
    return json(
      {
        ok: false,
        error: 'We could not set up your office just now. Please try again in a moment.',
      },
      503,
    )
  }
  const answer = (await made.response.json().catch(() => ({}))) as {
    ok?: boolean
    created?: boolean
    office_id?: string
    error?: string
  }
  if (answer.ok === true && typeof answer.office_id === 'string') {
    return json({ ok: true, created: answer.created === true, office_id: answer.office_id })
  }
  return json(
    {
      ok: false,
      error: typeof answer.error === 'string' ? answer.error : 'We could not set up your office.',
    },
    400,
  )
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return json({ ok: true })

  if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/health')) {
    // Deliberately says nothing about configuration beyond whether a token is
    // present at all. An unauthenticated caller learning which sections exist
    // is a probing aid.
    return json({ ok: true, endpoint: 'hq-api', token_configured: HQ_TOKEN !== '' })
  }

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')

  /*
    THE ONE ROUTE A PERSON WITH NO OFFICE MAY REACH: create_office (self-service account creation).
    It is answered BEFORE the normal flow because that flow refuses somebody with no office. It takes nothing from the
    body but a display name: the login, the address and the confirmation come from Supabase's own verification of the
    session, and the office and owner key are derived in the database from the verified auth id.
  */
  if (request.method === 'POST') {
    const peek = (await request
      .clone()
      .json()
      .catch(() => null)) as Record<string, unknown> | null
    if (peek !== null && typeof peek === 'object' && peek.action === 'create_office') {
      return await createOffice(presented, peek)
    }
  }

  const { verdict, principal, kind, office: sessionOffice, canCreate } = await allowed(presented)
  if (verdict === 'no_office') {
    return json(
      canCreate === true ? { error: 'no_office', can_create: true } : { error: 'no_office' },
      403,
    )
  }
  if (verdict === 'no') {
    return json({ error: 'unauthorized' }, 401)
  }
  /*
    COULD NOT CHECK IS NOT REFUSED, and the status code is the whole of the
    difference. The page clears a session on 401 and keeps it on anything else,
    so answering a throttled identity service with 401 would sign somebody out
    because Supabase was busy. 503 says what actually happened, grants nothing,
    and leaves the session where it is.
  */
  if (verdict === 'unknown') {
    return json(
      { error: 'The office could not check who you are just now. Try again in a moment.' },
      503,
    )
  }

  /*
    THE OFFICE THIS REQUEST ACTS IN, once, from the verified credential (P3). A signed-in member's is the one their login
    resolved to; the machine key's is the test office. Nothing in the body, the query or a header can change it.
  */
  const office = kind === 'service' ? await machineOffice() : (sessionOffice ?? null)

  // --- configuration -------------------------------------------------------
  //
  // POST, and only the named actions. Same rule as the reads: the page names an
  // ACTION from a fixed list and the projection lives in `app.hq_*` where it
  // can be reviewed. A page that could send SQL, or even a function name, is a
  // page that has the database rather than a dashboard.
  if (request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const actionName = String(body.action ?? '')
    const action = Object.hasOwn(ACTIONS, actionName) ? ACTIONS[actionName] : undefined
    if (action === undefined) {
      return json({ error: 'unknown action', actions: Object.keys(ACTIONS) }, 400)
    }
    /*
      WHO MAY DO WHAT (#385). Three kinds of credential, and only a person may do everything:

        service (the office key)  - SERVICE_MAY, and nothing that decides, speaks or connects;
        harness (a TEST member)   - SERVICE_MAY, plus the decisions whose database function itself
                                    enforces "a test principal decides only test traffic"
                                    (every action that carries the answering person, `by`);
        person                    - everything.

      A test member is a real signed-in session that the office key can ask `signin` to mint, so
      treating it like a person for anything the database does not check would hand the key a way
      round the gate (the review of the first cut found exactly that: credentials, connectors,
      settings and hiring all ran with no `p_by` for a session the key could mint). What the database
      does not check, a test member does not reach. 403, not 401: the credential is genuine.
    */
    const mayDo =
      kind === 'person' ||
      SERVICE_MAY.has(actionName) ||
      (kind === 'harness' && action.by !== undefined) ||
      // A test member may drop a file into a TEST project (checked below): the upload verification suite has
      // no other way to be a writer now that the office key is a machine (Run 4, Phase 0).
      (kind === 'harness' && actionName === 'document_upload')
    if (!mayDo) {
      return json(
        {
          error: 'person_required',
          message:
            kind === 'harness'
              ? 'This needs a signed-in person. A test member may only decide test traffic.'
              : 'This needs a signed-in person. The office key is a machine and cannot decide, approve, speak or connect as somebody.',
          action: actionName,
        },
        403,
      )
    }
    /*
      A session that names nobody is nobody to act as: every function that would have defaulted its
      principal ('grant', in several) must not be reached by one (#385).
    */
    if (
      kind !== 'service' &&
      (principal === null || principal === '') &&
      !SERVICE_MAY.has(actionName)
    ) {
      return json(
        {
          error: 'person_required',
          message: 'I cannot tell who you are, so this was not done.',
          action: actionName,
        },
        403,
      )
    }
    if (OPERATOR_ONLY.has(actionName)) {
      const operator =
        kind === 'person' && principal !== null && principal !== '' && (await isOperator(principal))
      if (!operator) {
        return json(
          {
            error: 'operator_required',
            message:
              'This changes something shared by the whole deployment, so only its operator can do it.',
            action: actionName,
          },
          403,
        )
      }
    }
    const args = { ...((body.args ?? {}) as Record<string, unknown>) }
    /*
      WHO IS ANSWERING is the gateway's fact, not the page's claim (0608).
      Whatever the client sent under this name is discarded, then the verified
      principal is written - or, for a credential that is not a person, nothing
      is, and the function refuses the answer by name.
    */
    if (action.by !== undefined) {
      delete args[action.by]
      if (principal !== null && principal !== '') args[action.by] = principal
    }
    // The client never supplies an office. Whatever arrived under these names is discarded here; the resolved office is
    // written only into a function that declares it (P3 wave 2 onward).
    for (const k of ['p_office', 'office_id', 'owner_key']) delete args[k]
    if (action.office === true) {
      if (!office) return json({ error: 'no_office' }, 403)
      args.p_office = office
    }
    if (action.personBy !== undefined) {
      delete args[action.personBy]
      if (kind === 'person' && principal !== null && principal !== '') {
        args[action.personBy] = principal
      }
    }
    const missing = action.required.filter(
      (k) => args[k] === undefined || args[k] === null || String(args[k]).trim() === '',
    )
    if (missing.length > 0) {
      return json({ error: `missing: ${missing.join(', ')}` }, 400)
    }

    /*
      A MACHINE CHANGES ONLY TEST PROJECTS (review R2-2, R2-3, 0638).

      These four are on SERVICE_MAY because suites and tooling need them, but none of them asks whose project it is:
      a machine created a real project (which provisions a Slack channel that cannot be deleted) and archived a real
      one (which switched its duties off). For a credential that is not a person the project must be a fixture's -
      `app.machine_project_ok` says so from the database, never from this file's idea of a name. Fails closed: a
      lookup that does not answer is a refusal.
    */
    if (kind !== 'person' && MACHINE_FIXTURE_ONLY.has(actionName)) {
      const ref = String((actionName === 'create_project' ? args.p_name : args.p_slug) ?? '')
      const ok = await fetch(`${DB_URL}/rest/v1/rpc/machine_project_ok`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ p_office: office, p_ref: ref }),
      })
        .then((r) => (r.ok ? r.json() : false))
        .catch(() => false)
      if (ok !== true) {
        return json(
          {
            error: 'person_required',
            message:
              'This changes a real project, so it needs a signed-in person. The office key and a test member change only test projects.',
            action: actionName,
          },
          403,
        )
      }
    }

    /*
      DROP A FILE ON A PROJECT (#126).

      Special-cased before the generic dispatch, because this is the one action
      that carries BYTES. Everything else is arguments to an RPC; this has to
      put an object in storage first and then record the row that points at it,
      and the service key that can do the first half must never leave here.

      #126 waited for #29's asset model and no longer has to: `documents` holds
      `storage_path`, `mime_type`, `byte_size` and `duration_s`, and
      `app.record_file_document` is the writer `collect.ts` already uses for a
      PDF read out of Drive. A dropped file is the same thing arriving by a
      different door — which is exactly why it does not need a fourth shape.

      §31: *"upload this somewhere else, then paste the link"* is an avoidable
      request for manual configuration, which is a design failure.
    */
    /*
      A CONTACT'S PHOTOGRAPH.

      Grant: *"Use the repository's established storage architecture. Do not
      store giant base64 images in inappropriate database fields."*

      So this is `document_upload`'s shape, deliberately: the bytes go into the
      same private `files` bucket, under the project's own prefix, and the
      DATABASE is told only the path. It is read back the way a document's file
      is - a short-lived signed URL minted here - so a client's photograph is no
      more reachable than their documents are, and a data URL never touches a
      column, a backup or a log line.

      Smaller than a document on purpose: 2 MB is a generous photograph and an
      ungenerous way to fill a 1 GB allowance.
    */
    if (actionName === 'contact_photo') {
      const contactId = String(args.p_contact_id ?? '')
      const projectId = String(args.p_project_id ?? '')
      const mime = String(args.p_mime ?? '').trim() || 'image/jpeg'
      const b64 = String(args.p_base64 ?? '')
      if (!/^[0-9a-f-]{36}$/i.test(contactId)) return json({ error: 'which contact?' }, 400)
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: 'which project?' }, 400)

      /*
        The contact must be this project's, and a test member only reaches a test project. Asked BEFORE the
        photograph is decoded or stored, and the path below is built from the project the database returns.
      */
      if (!office) return json({ error: 'no_office' }, 403)
      const target = await uploadTarget(
        office,
        'contact_photo',
        projectId,
        contactId,
        kind === 'service' ? null : principal,
      )
      if ('error' in target) {
        return json(
          { error: target.error },
          target.error === 'could not check the target' ? 503 : 404,
        )
      }

      /* Removing one is the same action with nothing attached. */
      /*
        Whether the RPC accepted the write. The response below is unchanged
        whatever it says; this only decides whether to kick the worker, which
        must follow a successful write and never a refused one (the rule the
        generic dispatch below follows).
      */
      let wrote = false
      const callRpc = async (fn: string, body: unknown): Promise<unknown> => {
        const r = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        wrote = r.ok
        return await r.json().catch(() => ({}))
      }

      if (b64 === '') {
        const removed = await callRpc('hq_contact_photo_set', {
          p_office: office,
          p_contact_id: contactId,
          p_path: null,
        })
        if (wrote) kickWorker()
        return json({ result: removed })
      }

      if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(mime)) {
        return json({ error: 'a photograph has to be an image' }, 400)
      }
      let bytes: Uint8Array
      try {
        const raw = atob(b64.includes(',') ? (b64.split(',')[1] ?? '') : b64)
        bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
      } catch {
        return json({ error: 'that image could not be read' }, 400)
      }
      if (bytes.byteLength === 0) return json({ error: 'that image is empty' }, 400)
      if (bytes.byteLength > 2 * 1024 * 1024) {
        return json({ error: 'that photograph is over 2 MB — a smaller one will do' }, 400)
      }

      const ext =
        mime
          .split('/')[1]
          ?.replace(/[^a-z0-9]+/g, '')
          .slice(0, 5) ?? 'jpg'
      const path = `${target.projectId}/contacts/${contactId}.${ext}`
      const put = await fetch(`${DB_URL}/storage/v1/object/files/${path}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': mime,
          'x-upsert': 'true',
        },
        body: bytes as unknown as BodyInit, // a typed array is a valid body at runtime; newer Deno typings reject the generic form
      })
      if (!put.ok) {
        console.error(`hq-api contact_photo: storage ${String(put.status)}`)
        return json({ error: 'the photograph could not be stored' }, 502)
      }
      const recorded = await callRpc('hq_contact_photo_set', {
        p_office: office,
        p_contact_id: contactId,
        p_path: path,
      })
      /*
        AND A LINK BACK, so the page can show what was just uploaded without a
        second round trip. Ten minutes, the same life every signed link in this
        function has: long enough to look at, short enough that one caught in a
        screenshot has expired.
      */
      const sign = await fetch(`${DB_URL}/storage/v1/object/sign/files/${path}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ expiresIn: 600 }),
      })
      const { signedURL } = (await sign.json().catch(() => ({}))) as { signedURL?: string }
      if (wrote) kickWorker()
      return json({
        result: recorded,
        photo: signedURL === undefined ? null : `${DB_URL}/storage/v1${signedURL}`,
      })
    }

    if (actionName === 'document_upload') {
      // Material is recorded as GIVEN BY somebody; a session with no owner key is nobody (#385).
      if (principal === null || principal === '') {
        return json({ error: 'I cannot tell who is adding this, so it was not stored.' }, 403)
      }
      const projectId = String(args.p_project_id ?? '')
      const name = String(args.p_name ?? '').trim()
      const mime = String(args.p_mime ?? '').trim() || 'application/octet-stream'
      const b64 = String(args.p_base64 ?? '')
      if (!/^[0-9a-f-]{36}$/i.test(projectId)) return json({ error: 'which project?' }, 400)
      if (name === '') return json({ error: 'the file needs a name' }, 400)
      if (kind === 'harness') {
        // A test member decides only test traffic (0614/0618); adding material to a REAL project is not that.
        const shown = await fetch(
          `${DB_URL}/rest/v1/projects?project_id=eq.${projectId}&select=is_fixture&limit=1`,
          { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
        ).catch(() => null)
        const rows =
          shown !== null && shown.ok
            ? ((await shown.json().catch(() => [])) as { is_fixture?: boolean }[])
            : []
        if (rows[0]?.is_fixture !== true) {
          return json(
            {
              error:
                'A test principal cannot add material to something real; it may only use a test project.',
            },
            403,
          )
        }
      }

      /* Authorized against the database BEFORE the bytes are decoded or stored (0650). */
      if (!office) return json({ error: 'no_office' }, 403)
      const target = await uploadTarget(office, 'document_upload', projectId, null, principal)
      if ('error' in target) {
        return json(
          { error: target.error },
          target.error === 'could not check the target' ? 503 : 404,
        )
      }

      /*
        Decoded here so the SIZE is the real one. A base64 string is a third
        larger than what it stands for, and refusing on the encoded length
        would refuse files that fit.

        `atob` and `Uint8Array`, never `Buffer`: edge functions run in Deno and
        CLAUDE.md records being bitten by that three times.
      */
      let bytes: Uint8Array
      try {
        const raw = atob(b64.includes(',') ? (b64.split(',')[1] ?? '') : b64)
        bytes = new Uint8Array(raw.length)
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i)
      } catch {
        return json({ error: 'that file could not be read' }, 400)
      }
      if (bytes.byteLength === 0) return json({ error: 'that file is empty' }, 400)
      const LIMIT = 8 * 1024 * 1024
      if (bytes.byteLength > LIMIT) {
        return json(
          {
            error:
              `that file is ${String(Math.round(bytes.byteLength / 1024 / 1024))} MB and the limit ` +
              'here is 8 MB. Attach it to a source the office can read instead — Drive or Notion.',
          },
          400,
        )
      }

      /*
        `<project>/upload/<uuid>.<ext>`, the convention `filePath` uses: the
        project first so a project's files are one prefix and removing a
        project is one delete, the connector second so two systems cannot
        collide, and a fresh uuid as the name because a dropped file has no
        remote id to be stable against. Every segment is scrubbed — a filename
        arrives from a desktop and `..` reaching the storage API is a traversal.
      */
      const dot = name.lastIndexOf('.')
      const ext = (dot > 0 ? name.slice(dot + 1) : '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 8)
      const path = `${target.projectId}/upload/${crypto.randomUUID()}${ext === '' ? '' : `.${ext}`}`

      const put = await fetch(`${DB_URL}/storage/v1/object/files/${path}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': mime,
          'x-upsert': 'true',
        },
        body: bytes as unknown as BodyInit, // a typed array is a valid body at runtime; newer Deno typings reject the generic form
      })
      if (!put.ok) {
        console.error(`hq-api document_upload: storage ${String(put.status)}`)
        return json({ error: 'the file could not be stored' }, 502)
      }

      const recorded = await fetch(`${DB_URL}/rest/v1/rpc/record_file_document`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_office: office,
          p_project_id: projectId,
          p_title: name.slice(0, 200),
          p_storage_path: path,
          p_mime_type: mime,
          p_byte_size: bytes.byteLength,
          p_added_by: principal,
          /*
            HIS, not ours (0414). `record_file_document` was written for a PDF
            the office read out of Drive and hardcoded `origin = 'made'`, so a
            file he dropped announced itself on his own dashboard as having
            been produced by "grant". The column exists to separate material
            the office was GIVEN from material it MADE, and 0169's point is
            that confusing the two lets an agent cite its own output as a
            source.
          */
          p_origin: 'yours',
        }),
      })
      if (!recorded.ok) {
        /*
          The object is stored and the row is not, which is the one state worth
          naming rather than hiding: the bytes are paid for and nothing points
          at them. The retention pass cannot see it either, because that one is
          about the build bucket. Logged with the path so it can be found.
        */
        console.error(
          `hq-api document_upload: stored ${path} but the row failed (${String(recorded.status)})`,
        )
        return json({ error: 'the file was stored but could not be filed' }, 502)
      }
      const filed = (await recorded.json()) as Record<string, unknown>
      /*
        A text file is READ here, because here is the only moment the bytes are in hand (#408). Stored with no text, a
        document can never be found by what it says, and the office told a person it had no budget while holding one.
        Only types a person writes in: a PDF or an image needs a reader this function does not have, and says so by
        leaving `content` null rather than inventing an empty string (0207). A failure to index never costs the file:
        it is stored and filed, which is what was asked.
      */
      /*
        #419: text, Markdown, HTML, Word and PDF are all read (`fileText`); anything else, and a PDF that is a picture of a
        page, is stored and filed but NOT searchable, and the reply says so rather than leaving the person to find out when
        a question about it goes unanswered. `searchable` is a fact about this file at this moment, not a promise.
      */
      let searchable: { searchable: boolean; why?: string } = {
        searchable: false,
        why: 'the file was filed but its text could not be read',
      }
      if (typeof filed.document_id === 'string') {
        try {
          const read = await fileText(bytes, mime, name)
          if (read.text === null) {
            searchable = { searchable: false, why: read.why }
          } else {
            const idx = await fetch(`${DB_URL}/rest/v1/rpc/index_file_text`, {
              method: 'POST',
              headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                p_office: office,
                p_document_id: filed.document_id,
                p_text: read.text,
              }),
            })
            searchable = idx.ok
              ? { searchable: true }
              : { searchable: false, why: 'the file was filed but its text could not be stored' }
          }
        } catch {
          console.error(`hq-api document_upload: ${path} was filed but could not be indexed`)
        }
      }
      kickWorker()
      return json({ action: actionName, result: { ...filed, ...searchable } })
    }

    const done = await fetch(`${DB_URL}/rest/v1/rpc/${action.fn}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    if (!done.ok) {
      console.error(`hq-api ${actionName}: upstream ${String(done.status)}`)
      return json({ error: 'the action failed' }, 502)
    }

    /*
      Slack, ADR-0065. The database half has answered; the two things only the gateway can do are done here.

      BEGIN: compose Slack's authorise link from the one-time state and the app's public settings. The state reaches ONLY the
      signed-in person's own browser (inside the link) and is single use.

      DISCONNECT: the database retired everything and handed back the bot token, once, so it can be revoked at Slack. The
      token is used for that one call and is not in the reply, a log line or an error message.
    */
    if (actionName === 'slack_link_begin' || actionName === 'slack_link_disconnect') {
      const said = (await done.json().catch(() => null)) as Record<string, unknown> | null
      if (said === null) return json({ error: 'the action failed' }, 502)
      if (actionName === 'slack_link_begin') {
        if (said.ok !== true) return json({ action: actionName, result: said })
        const settings = await fetch(`${DB_URL}/rest/v1/rpc/slack_link_client`, {
          method: 'POST',
          headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
          },
          body: '{}',
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null)
        const link = authorizeUrl({
          clientId: String(said.client_id ?? ''),
          redirectUri: `${DB_URL}/functions/v1/slack-oauth`,
          state: String(said.state ?? ''),
          scopes: typeof settings?.scopes === 'string' ? settings.scopes : null,
        })
        return json({
          action: actionName,
          result: { ok: true, url: link, expires_at: said.expires_at },
        })
      }
      const token = typeof said.bot_token === 'string' ? said.bot_token : ''
      const revoked = token === '' ? null : await revokeToken(fetch, token)
      return json({
        action: actionName,
        result: {
          ok: said.ok === true,
          removed: said.removed ?? 0,
          revoked_at_slack: revoked,
          message: said.message,
        },
      })
    }
    // After the write succeeded, never before: a kick for an action that was
    // refused would start a pass for work that does not exist.
    kickWorker()
    return json({ action: actionName, result: await done.json() })
  }

  const url = new URL(request.url)

  /*
    THE DOCUMENT AN AGENT READS TO FIND OUT WHAT IT CAN DO (#13).

    Section 11's requirement is "UI action = API operation = agent-accessible
    operation", and the third of those was true only for whoever had read this
    file. There was no description of the surface anywhere: an agent holding
    the bearer token could call anything on it and had no way to learn what
    anything was.

    ## Generated, never maintained beside the code

    #13 asks for the document to be generated or maintained beside the routes
    rather than written by hand in prose, and generated is the only one of
    those that cannot drift. Every name here comes from the SECTIONS and
    ACTIONS tables above - the same tables the dispatcher uses - so a section
    added without a line here is impossible, and one removed disappears from
    the document in the same commit. A hand-written OpenAPI file would be a
    second copy of the whitelist, and a list built twice is this repository's
    most-repeated defect.

    ## It describes what is there, not a REST API somebody would prefer

    #13's own instruction: extend the gateway, do not replace it, because its
    whitelist is a security property worth keeping. So this is an honest
    description of an RPC-shaped surface - a named section and a named action -
    rather than resource routes invented to make the document look
    conventional. A /projects/{id} forwarding to ?section=project would be a
    second door onto the same room, and the second door is the one that stops
    being checked.

    ## Behind the same token as everything else

    The first draft of this said it should be readable without one, on a
    chicken-and-egg argument. That argument does not apply here: there is
    exactly ONE token (#13's own constraint — no second auth system), every
    legitimate reader already holds it, and it is issued out of band through
    `npm run hq:token`. An unauthenticated endpoint would have been a wider
    surface bought for nobody. The branch therefore sits after the auth gate,
    which is where it landed by construction and where it belongs.
  */
  if (url.pathname.endsWith('/openapi.json') || url.searchParams.get('section') === 'openapi') {
    const ids = Object.values(SECTIONS).some((x) => x.arg !== undefined)
    const texts = [
      ...new Set(
        Object.values(SECTIONS).flatMap((x) => (x.textArg === undefined ? [] : [x.textArg.param])),
      ),
    ]
    const doc = {
      openapi: '3.1.0',
      info: {
        title: 'Agentic Team HQ',
        version: '1.0.0',
        description:
          'One bearer token, two operations. GET reads a named projection; POST performs a ' +
          'named action. Both lists are whitelists: a name not listed does not exist, and ' +
          'every projection lives in app.hq_* where it can be reviewed.',
      },
      servers: [{ url: `${url.origin}/functions/v1/hq-api` }],
      components: {
        securitySchemes: {
          bearer: { type: 'http', scheme: 'bearer', description: 'hq.api_token, from the vault.' },
        },
      },
      security: [{ bearer: [] }],
      paths: {
        '/': {
          get: {
            summary: 'Read one named projection',
            parameters: [
              {
                name: 'section',
                in: 'query',
                required: true,
                schema: { type: 'string', enum: Object.keys(SECTIONS).sort() },
              },
              ...(ids
                ? [
                    {
                      name: 'id',
                      in: 'query',
                      required: false,
                      schema: { type: 'string', format: 'uuid' },
                      description: 'Required by the sections that name one thing.',
                    },
                  ]
                : []),
              ...texts.map((n) => ({
                name: n,
                in: 'query',
                required: false,
                schema: { type: 'string' },
              })),
              {
                name: 'project',
                in: 'query',
                required: false,
                schema: { type: 'string', format: 'uuid' },
                description: 'Narrows the sections that declare a scope.',
              },
            ],
            responses: {
              '200': { description: 'The projection, under data.' },
              '400': { description: 'A section that is not listed, or a malformed id.' },
              '401': { description: 'No token, or the wrong one. The body says nothing else.' },
            },
          },
          post: {
            summary: 'Perform one named action',
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    required: ['action'],
                    properties: {
                      action: { type: 'string', enum: Object.keys(ACTIONS).sort() },
                      args: { type: 'object', additionalProperties: true },
                    },
                  },
                },
              },
            },
            responses: {
              '200': { description: 'The action ran; result is what the RPC returned.' },
              '400': { description: 'An action that is not listed, or missing arguments.' },
              '401': { description: 'No token, or the wrong one.' },
              '502': { description: 'The action failed upstream.' },
            },
          },
        },
      },
      /*
        The per-operation detail, as data rather than as prose.

        Not a requestBody schema per action: OpenAPI cannot vary a body by the
        VALUE of a field without oneOf over every action, which would be forty
        schemas nobody reads. What an agent wants is which arguments are
        required, and this says so from the same table the dispatcher checks.
      */
      'x-actions': Object.fromEntries(
        Object.entries(ACTIONS)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, a]) => [name, { function: a.fn, required: a.required }]),
      ),
      'x-sections': Object.fromEntries(
        Object.entries(SECTIONS)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, x]) => [
            name,
            {
              function: x.fn,
              ...(x.arg === undefined ? {} : { takes: 'id' }),
              ...(x.textArg === undefined ? {} : { takes: x.textArg.param }),
              ...(x.scoped === true ? { scoped: true } : {}),
            },
          ]),
      ),
    }
    return json(doc)
  }

  const name = url.searchParams.get('section') ?? 'overview'
  /*
    THE DEPLOYMENT'S OWN PAGES (P4, second-user acceptance).

    A second real person signed in and read these: `google` (the deployment's single Google connection, shown as
    connected, with its OAuth client id), `build` (the operator's development feed, with screenshots), `ci_lately` and
    `ci_budget` (the CI ledger, naming the suites that ran) and `bots` (the deployment's bot handle). None is an office's
    data - they carry no `office: true` because there is no office to scope them to - which is exactly why an office
    boundary never covered them. They describe the deployment, so they are the operator's, like Drive (#400) and the
    deployment-wide actions (E14). The machine key may still read them (it is the deployment's own credential and the
    suites and the deploy probes use it); a person who is not an operator, and a harness member, may not.
  */
  if (OPERATOR_SECTIONS.has(name)) {
    const mayRead =
      kind === 'service' ||
      (kind === 'person' && principal !== null && principal !== '' && (await isOperator(principal)))
    if (!mayRead) {
      return json(
        {
          error: 'operator_required',
          message: 'That page describes the deployment itself, so only its operator can read it.',
          section: name,
        },
        403,
      )
    }
  }
  // `Object.hasOwn`, not a bare lookup. `SECTIONS['constructor']` and
  // `SECTIONS['__proto__']` are both truthy through the prototype chain, so a
  // bare `!== undefined` let three inherited names past the guard and on to a
  // fetch of `/rpc/undefined` with the service key. Nothing came back and
  // nothing leaked — but the comment above says "a section not named here does
  // not exist", and until now that was not true.
  /*
    PREVIEWING AN EXTERNAL DOCUMENT ON DEMAND (0990). Not an import.

    `document_preview` answers one of five states (ready, loading, failed, unsupported, stale) for a document id; the
    decisions live in `src/documents/preview.ts`, uploaded beside this file, and the facts in `public.hq_document_preview_plan`.
    `document_preview_file` streams the bytes of a PDF or an image from Drive to the browser in the response and keeps
    NOTHING: no Storage write, no path, no URL. Only derived text and the source's version markers are recorded, through
    `public.hq_document_preview_record`, so agents can search the text.

    The office is the verified session's, never a caller-named one, and the document must belong to it (and to the project
    the page says it is looking at). Reaching Drive uses the same short-lived token as the browse above, so it is the
    operator's act until an office holds a Google connection of its own (#400); anyone else gets a plain `failed` that
    cannot be retried, and still sees what is held for a connected source.
  */
  if (name === 'document_preview' || name === 'document_preview_file') {
    if (office === null) return json({ error: 'no_office' }, 403)
    const id = url.searchParams.get('id') ?? ''
    const projectSlug = (url.searchParams.get('project') ?? '').trim()
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return json({ error: 'that section needs a valid id', section: name }, 400)
    }
    if (projectSlug !== '' && !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(projectSlug)) {
      return json({ error: 'project must be a project slug', section: name }, 400)
    }
    const callPreviewRpc = async (fn: string, body: Record<string, unknown>): Promise<unknown> => {
      const r = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`${fn} ${String(r.status)}`)
      return await r.json()
    }
    let plan: PreviewPlan
    try {
      plan = (await callPreviewRpc('hq_document_preview_plan', {
        p_office: office,
        p_document_id: id,
        p_project_slug: projectSlug === '' ? null : projectSlug,
      })) as PreviewPlan
    } catch {
      return json({
        data: {
          state: 'failed',
          reason_code: 'unavailable',
          reason: 'Team HQ could not look this document up just now. Try again shortly.',
          retryable: true,
          alternatives: ['retry'],
        },
      })
    }
    const providerFor = async () => {
      if (
        !(
          kind === 'person' &&
          principal !== null &&
          principal !== '' &&
          (await isOperator(principal))
        )
      ) {
        return {
          code: 'operator_required',
          retryable: false,
          message:
            "The Drive connection here is the deployment operator's own, so only they can read from it. Open the source instead.",
        } satisfies Failure
      }
      const access = await googleToken(String(principal), office)
      if ('error' in access) {
        return {
          code: access.error.startsWith('Google is not connected')
            ? 'not_connected'
            : 'unauthorised',
          retryable: false,
          message: access.error,
        } satisfies Failure
      }
      return driveProvider(access.token)
    }
    const extractText = async (bytes: Uint8Array, mime: string, fileName: string) => {
      const read = await fileText(bytes, mime, fileName)
      return read.text === null ? { text: null, why: read.why } : { text: read.text }
    }
    const record = async (a: {
      meta: {
        modifiedTime: string | null
        mime: string
        version: string | null
        size: number | null
      }
      kind: 'text' | 'pdf' | 'image'
      text: string | null
      truncated: boolean
    }): Promise<boolean> => {
      const done = (await callPreviewRpc('hq_document_preview_record', {
        p_office: office,
        p_document_id: id,
        p_meta: {
          modifiedTime: a.meta.modifiedTime,
          mime: a.meta.mime,
          version: a.meta.version,
          size: a.meta.size,
        },
        p_kind: a.kind,
        p_text: a.text,
        p_truncated: a.truncated,
      })) as { ok?: boolean }
      return done?.ok === true
    }

    if (name === 'document_preview') {
      const result = await previewDocument({
        plan,
        provider: providerFor,
        extractText,
        record,
        now: Date.now(),
      })
      return json({ data: result })
    }

    const made = await providerFor()
    if (!('describe' in made)) return json({ error: made.message }, 403)
    const streamed = await streamDocument({ plan, provider: made, extractText, record })
    if (!streamed.ok) return json({ error: streamed.failure.message }, streamed.status)
    const safeName = streamed.name.replace(/[^\w. -]+/g, '_').slice(0, 120) || 'document'
    return new Response(streamed.bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'content-type': streamed.mime,
        'content-length': String(streamed.bytes.byteLength),
        'content-disposition': `inline; filename="${safeName}"`,
        // Short-lived by construction: nothing keeps this, and nothing downstream may either.
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'access-control-allow-origin': '*',
        'access-control-allow-headers': 'authorization, content-type',
      },
    })
  }

  /*
    BROWSING GOOGLE DRIVE.

    Grant: *"Grant should be able to add file/document, choose Google Drive,
    browse/search/select appropriate Drive item... Do not build a fake list of
    Drive filenames. Do not hard-code Drive fixtures."*

    So this is Drive itself, asked live, with the office's own grant. It is a
    READ and it records nothing: picking is a separate, deliberate act below.

    `folder` walks into one; `q` searches by name across the drive. Both are
    passed to Drive as parameters rather than interpolated into its query
    language without escaping - a file named with an apostrophe is ordinary and
    would otherwise break the query it appears in.
  */
  if (name === 'drive') {
    /*
      THE DRIVE BEHIND THIS IS THE DEPLOYMENT'S, not the caller's (#400). The refresh token below is one
      fixed credential, so browsing is the operator's act until an office holds a Google connection of its
      own: any other member would be browsing the operator's files. A GET section has no per-kind rule of
      its own, so this one names it.
    */
    if (
      !(
        kind === 'person' &&
        principal !== null &&
        principal !== '' &&
        (await isOperator(principal))
      )
    ) {
      return json(
        {
          error: 'operator_required',
          message: "Drive here is the deployment operator's own, so only they can browse it.",
          action: 'drive',
        },
        403,
      )
    }
    if (office === null) return json({ error: 'no_office' }, 403)
    const access = await googleToken(String(principal), office)
    if ('error' in access) return json({ error: access.error }, 502)
    const folder = (url.searchParams.get('folder') ?? '').replace(/['\\]/g, '')
    const q = (url.searchParams.get('q') ?? '').replace(/['\\]/g, '').slice(0, 120)
    const where =
      q === ''
        ? `'${folder === '' ? 'root' : folder}' in parents and trashed = false`
        : `name contains '${q}' and trashed = false`
    const fields =
      'files(id,name,mimeType,modifiedTime,iconLink,thumbnailLink,webViewLink,size,owners(displayName))'
    const asked = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(where)}` +
        `&fields=${encodeURIComponent(fields)}&pageSize=60` +
        '&orderBy=folder,modifiedTime desc&supportsAllDrives=true&includeItemsFromAllDrives=true',
      { headers: { Authorization: `Bearer ${access.token}` } },
    )
    const body = (await asked.json().catch(() => ({}))) as {
      files?: Record<string, unknown>[]
      error?: { message?: string }
    }
    if (!asked.ok) {
      return json(
        { error: `Drive would not answer: ${String(body.error?.message ?? asked.status)}` },
        502,
      )
    }
    return json({
      data: {
        folder,
        q,
        files: (body.files ?? []).map((f) => ({
          id: String(f.id ?? ''),
          name: String(f.name ?? ''),
          mime: String(f.mimeType ?? ''),
          isFolder: String(f.mimeType ?? '') === 'application/vnd.google-apps.folder',
          modified: String(f.modifiedTime ?? ''),
          icon: String(f.iconLink ?? ''),
          /* Drive's own thumbnail, which needs Drive's own credential - so it
             is passed through as a fact about the file and the page is told
             below that it cannot fetch it directly. */
          thumbnail: String(f.thumbnailLink ?? ''),
          open: String(f.webViewLink ?? ''),
          owner: String(
            (f.owners as { displayName?: string }[] | undefined)?.[0]?.displayName ?? '',
          ),
        })),
      },
    })
  }

  const section = Object.hasOwn(SECTIONS, name) ? SECTIONS[name] : undefined
  if (section === undefined) {
    return json({ error: 'unknown section', sections: Object.keys(SECTIONS) }, 400)
  }

  /*
    The one argument a caller may supply, and only where the section declares it.

    Validated as a UUID here rather than left to Postgres. An id that is not a
    uuid comes back from PostgREST as a type error, and §25 forbids putting a
    database error in front of a person — but more to the point, this is the
    only place in the API where a query string reaches an RPC, so the shape is
    checked at the door.

    `id` is ignored entirely for a section that declares no `arg`, so adding
    `?id=` to any other section changes nothing.
  */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let args: Record<string, unknown> = section.args ?? {}
  if (section.arg !== undefined) {
    const id = url.searchParams.get('id') ?? ''
    if (!UUID.test(id)) {
      return json({ error: 'that section needs a valid id', section: name }, 400)
    }
    args = { ...args, [section.arg]: id }
  }
  /*
    A word from a known list (#259).

    Before `textArg`, because it is the stricter of the two and the ordering
    says so. An unknown value is named rather than defaulted: the whole reason
    this exists instead of a default in the RPC is that a default which is also
    a legitimate answer makes a typo indistinguishable from a choice.
  */
  if (section.oneOf !== undefined) {
    const { param, arg, values } = section.oneOf
    const value = (url.searchParams.get(param) ?? '').trim().toLowerCase()
    if (!values.includes(value)) {
      return json(
        { error: `that section needs ${param} to be one of: ${values.join(', ')}`, section: name },
        400,
      )
    }
    args = { ...args, [arg]: value }
  }

  /*
    And the optional extras (#259), after the required ones.

    An unrecognised word in a LIST is refused by name, exactly as `oneOf` does
    and for the same reason — a typo must not be answerable with something
    plausible. A missing parameter is not refused, because missing is the
    ordinary case and is what `also` exists for.
  */
  for (const extra of section.also ?? []) {
    const raw = url.searchParams.get(extra.param)
    if (raw === null || raw.trim() === '') continue
    if (extra.values === undefined) {
      // Free text. Capped for the same cost reason `textArg` is capped; it
      // reaches Postgres as an RPC parameter and is never interpolated.
      args = { ...args, [extra.arg]: raw.slice(0, 200) }
      continue
    }
    const value = raw.trim().toLowerCase()
    if (!extra.values.includes(value)) {
      return json(
        {
          error: `${extra.param} must be one of: ${extra.values.join(', ')}`,
          section: name,
        },
        400,
      )
    }
    args = { ...args, [extra.arg]: value }
  }

  /*
    A text argument, for search.

    Bounded rather than validated by pattern: a search query is arbitrary text
    by definition, so there is no shape to check. It reaches Postgres as an RPC
    PARAMETER — never interpolated — so the cap is about cost and abuse, not
    injection: `websearch_to_tsquery` will happily parse two kilobytes and scan
    the corpus for it.

    An empty query is refused rather than answered with everything. "Show me
    all of it" is a different request and would be a different section.
  */
  if (section.textArg !== undefined) {
    const { param, arg } = section.textArg
    const value = (url.searchParams.get(param) ?? '').trim()
    if (value === '' || value.length > 200) {
      return json({ error: `that section needs ${param} of 1 to 200 characters` }, 400)
    }
    args = { ...args, [arg]: value }
  }
  /*
    Scoped to one project when asked, and only where the section takes it.

    #37 wants search scoped to the current project by default and widenable to
    everything, and the page is what knows which one you are looking at. Gated
    on the SECTION rather than on the parameter being present, because passing
    `p_project` to an RPC with no such argument is an error, not a no-op — and
    `relations` was about to be the first section to prove it.
  */
  if (section.scoped === true) {
    const within = url.searchParams.get('project') ?? ''
    if (within !== '') {
      if (!UUID.test(within)) return json({ error: 'project must be an id' }, 400)
      args = { ...args, p_project: within }
    }
  }

  /*
    Narrowing a search by the graph (#37, migration 0397).

    Named parameters in, one jsonb out. The adapter TRANSLATES and decides
    nothing: which edges exist is `app.relations_of`'s business and which keys
    mean anything is the RPC's, so there is no second copy of either here.

    Values are shape-checked and a bad one is REFUSED, which is the opposite of
    how the RPC treats an unknown KEY — and deliberately. An unrecognised key
    is a caller asking for something this version does not have, and ignoring
    it leaves every other filter working. A malformed uuid or date is a caller
    getting it wrong, and passing it through would surface as a 502 with no
    explanation, which is a worse answer than saying which parameter is bad.

    `kinds` is passed through without an allow-list. Enumerating them here
    would be a list that goes stale the day the search learns a third kind,
    and this repository has paid for that four times.
  */
  if (section.filtered === true) {
    const filters: Record<string, unknown> = {}

    const kinds = (url.searchParams.get('kinds') ?? '')
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k !== '')
    if (kinds.length > 0) {
      if (kinds.some((k) => !/^[a-z_]{1,24}$/.test(k))) {
        return json({ error: 'kinds must be short lowercase words, comma separated' }, 400)
      }
      filters.kinds = kinds
    }

    const tag = (url.searchParams.get('tag') ?? '').trim()
    if (tag !== '') {
      if (tag.length > 80) return json({ error: 'tag is too long' }, 400)
      filters.tag = tag
    }

    for (const bound of ['since', 'until'] as const) {
      const raw = (url.searchParams.get(bound) ?? '').trim()
      if (raw === '') continue
      if (Number.isNaN(Date.parse(raw))) {
        return json({ error: `${bound} must be a date` }, 400)
      }
      filters[bound] = new Date(raw).toISOString()
    }

    /*
      One parameter for every relation query the issue names — by producing
      agent, by related contact, by source, by collection — because they are
      one traversal with a different starting point.
    */
    const related = (url.searchParams.get('related') ?? '').trim()
    if (related !== '') {
      const [kind, ...rest] = related.split(':')
      const id = rest.join(':')
      if (!/^[a-z_]{1,24}$/.test(kind ?? '') || !UUID.test(id)) {
        return json({ error: 'related must be kind:uuid, for example agent:<id>' }, 400)
      }
      filters.related_to = { kind, id }
    }

    if (Object.keys(filters).length > 0) args = { ...args, p_filters: filters }
  }

  if (section.office === true) {
    if (!office) return json({ error: 'no_office' }, 403)
    args = { ...args, p_office: office }
  }

  const response = await fetch(`${DB_URL}/rest/v1/rpc/${section.fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })

  if (!response.ok) {
    // The upstream detail stays here. A database error message in a browser is
    // schema disclosure, and it is also the "raw debug detail" §25 forbids.
    console.error(`hq-api ${name}: upstream ${String(response.status)}`)
    return json({ error: 'upstream failed', section: name }, 502)
  }

  const data = await response.json()

  /*
    A document with a file gets a signed URL, minted here (#96).

    The `files` bucket is PRIVATE, so `storage_path` is useless to a browser —
    an href on it would 404, and making the bucket public to avoid this would
    put every document Grant has ever imported on the open internet.

    Signing needs the service key, which exists here and must never exist in
    the page. So the RPC returns the path, this swaps it for a URL, and the
    path itself is dropped from the response: the browser gets a link it can
    follow and learns nothing about how storage is laid out.

    Ten minutes. Long enough to open a PDF and read it, short enough that a URL
    caught in a screenshot — and these get attached to build steps — has
    expired before anyone else could use it. The page fetches a fresh one every
    time a document is opened, so a longer life buys nothing.
  */
  /**
   * One path, one ten-minute link, or null when it could not be signed.
   *
   * Extracted so the browsing ledger below can reuse it rather than growing a
   * second copy of the same twelve lines. Never throws: a link that could not
   * be minted degrades to the text, and a section failing entirely because a
   * thumbnail could not be signed would be a worse product than one missing a
   * thumbnail.
   */
  const signPath = async (path: string): Promise<string | null> => {
    const signed = await fetch(`${DB_URL}/storage/v1/object/sign/files/${path}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 600 }),
    })
    if (!signed.ok) {
      console.error(`hq-api ${name}: could not sign (${String(signed.status)})`)
      return null
    }
    const { signedURL } = (await signed.json()) as { signedURL?: string }
    return signedURL ? `${DB_URL}/storage/v1${signedURL}` : null
  }

  if (name === 'document' && typeof data?.path === 'string' && data.path !== '') {
    const url = await signPath(data.path)
    // Not fatal: the reader falls back to the text, which is usually there.
    if (url !== null) data.url = url
    data.path = undefined
  }

  /*
    A CONTACT'S PHOTOGRAPH, signed exactly as a document's file is.

    The database holds a storage path and the page must never see one: the
    bucket is private on purpose, and a path tells a reader how storage is laid
    out while being useless to them. So each one is swapped for a ten-minute
    link and the path is dropped from the response.

    Walked rather than mapped, because contacts arrive nested inside whichever
    project they belong to and the shape of that payload is not this function's
    to know. Signing is serial and a project has a handful of contacts, so the
    cost is small; a page with fifty would deserve a batch.
  */
  if (name === 'studio' && Array.isArray((data as { projects?: unknown[] })?.projects)) {
    for (const project of (data as { projects: Record<string, unknown>[] }).projects) {
      const people = project.contacts
      if (!Array.isArray(people)) continue
      for (const person of people as Record<string, unknown>[]) {
        const path = person.photo
        if (typeof path !== 'string' || path === '') continue
        const url = await signPath(path)
        person.photo = url === null ? undefined : url
      }
    }
  }

  /*
    The screenshot of a page the office opened (#16, #135).

    `app.browser_lately` has returned `shot_path` since the browsing ledger
    existed and NOTHING has ever rendered it — #16 asks for "a recent
    screenshot" on the Browser tab and the picture was sitting in the payload
    the whole time, useless, because the `files` bucket is private and a raw
    path 404s from a browser. The same defect class as a payload that gains a
    key two of its three readers never learn about.

    Signed here rather than in the page, for the reason the document branch
    gives: signing needs the service key and the service key must never exist
    in the browser. The raw path is dropped afterwards, so the page gets a
    link it can follow and learns nothing about how storage is laid out.
  */
  if (name === 'browser_lately' && Array.isArray(data)) {
    for (const row of data as { shot_path?: unknown; shot_url?: string | null }[]) {
      if (typeof row.shot_path === 'string' && row.shot_path !== '') {
        row.shot_url = await signPath(row.shot_path)
      }
      row.shot_path = undefined
    }
  }

  /*
    What the page may OFFER. The deployment-wide actions (OPERATOR_ONLY) are refused to anybody who is not the
    operator, and the Settings page used to offer them anyway: a second person saw Approve, Configure and the Slack
    credential boxes, pressed one and was told it was not theirs to change. Said once, on the one payload Settings
    reads, from the same fact the refusal uses. It only decides what is DRAWN; the gateway still refuses.
  */
  if (
    name === 'studio_settings' &&
    data !== null &&
    typeof data === 'object' &&
    !Array.isArray(data)
  ) {
    const operator =
      kind === 'service' ||
      (kind === 'person' && principal !== null && principal !== '' && (await isOperator(principal)))
    ;(data as Record<string, unknown>).viewer = { operator }
  }

  return json({ section: name, data })
})
