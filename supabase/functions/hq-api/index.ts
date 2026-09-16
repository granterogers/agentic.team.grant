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

const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** The complete list. A section not named here does not exist. */
const SECTIONS: Readonly<
  Record<
    string,
    {
      fn: string
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
      /** Whether `?project=<uuid>` narrows this section. Search only. */
      scoped?: boolean
    }
  >
> = {
  overview: { fn: 'hq_overview' },
  staff: { fn: 'hq_staff' },
  usage: { fn: 'hq_usage' },
  activity: { fn: 'hq_activity', args: { p_limit: 50 } },
  series: { fn: 'hq_series', args: { p_days: 30 } },
  connections: { fn: 'hq_connections' },
  projects: { fn: 'hq_projects' },
  artifacts: { fn: 'hq_artifacts' },
  settings: { fn: 'hq_settings' },
  team: { fn: 'hq_team' },
  // Everything the studio renders, in the shape web/studio/data.js already
  // exports (#68, ADR-0019). One call rather than nine: the studio paints the
  // whole shell at once and a page that fetches per section feels broken while
  // being correct — the argument 0120 made for the tool catalogue.
  studio: { fn: 'hq_studio' },
  /*
    "Has anything changed" (#117, migration 0262).

    One row, five numbers and a timestamp. The studio polls this while the tab
    is in front of you and only refetches `studio` when the digest differs, so
    the common answer — nothing has happened — costs a few hundred bytes.

    Its own section rather than a field on `studio`, because the whole point is
    that it can be asked without paying for the payload it guards.
  */
  pulse: { fn: 'hq_pulse' },
  // The Settings viewer, in the shapes settings.js already exports (#68).
  studio_settings: { fn: 'hq_studio_settings' },
  /*
    The usage dashboard (#61), from `usage_overview` rather than `hq_usage`.

    Two functions, two shapes, and the studio wants the second: `hq_usage` is
    the old page's, grouped by subsystem; `usage_overview` is grouped by SERVICE
    with a quota and a provenance on each, which is what Grant asked for —
    *"a fraction of what's being spent over a monthly, weekly, daily quota"*.
    `web/studio/usage.js` was written in its exact shape.
  */
  usage_overview: { fn: 'usage_overview', args: { p_days: 30 } },
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
  document: { fn: 'studio_document', arg: 'p_document_id' },
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
  conversation: { fn: 'conversation_history', arg: 'p_project_id' },
  /*
    How fast the conversation is growing, and how much room is left (#204).

    Its own section for the same reason `pulse` is: it is a cheap question that
    should be answerable without paying for a payload it is not part of. And it
    is HERE rather than in a script because of the instruction that outranks
    most others — "I want to reduce my dependence on Claude or another coding
    interface for maintaining and extending the system." A number an agent has
    to run something to get is a number Grant does not have.
  */
  conversation_growth: { fn: 'conversation_growth' },
  /*
    Which state each conversation surface is in (#198).

    Not a field on `connections`: that one answers "is this credential alive",
    and this answers "can Grant have a conversation there, and is anything
    wrong with it right now" — which needs the credential AND the traffic AND
    the last day of delivery failures together. Two questions, two sections.
  */
  conversation_channels: { fn: 'conversation_channels' },
  /*
    The MCP server, as a page (#91).

    Its own section rather than part of `studio_settings`, because it is the
    only tab that reads three tables nobody else touches and putting it in the
    shared payload would make every settings open pay for it.

    Nothing in the RPC selects `token_sha256`. This tab gets captured by
    `npm run shots` and attached to a build step on a public page.
  */
  mcp: { fn: 'hq_mcp' },
  // What the office did and what is being built, as one page (#68).
  lately: { fn: 'hq_studio_lately', args: { p_limit: 40 } },
  // The first-run checklist, for the Setting up pane (#68). `setup` already
  // exists above and serves the same function; named apart so the studio's
  // fetch is legible next to `studio` and `studio_settings`.
  studio_setup: { fn: 'hq_setup' },
  google: { fn: 'hq_google' },
  // What to do next, for a person who has just opened this for the first time.
  setup: { fn: 'hq_setup' },
  // What each kind of work costs, measured and modelled (§11).
  cost: { fn: 'hq_cost_per_outcome', args: { p_days: 30 } },
  // Which bot speaks as whom, and which are spare.
  bots: { fn: 'hq_bots' },
  // Who may message Grant directly, how loud a thing has to be to reach his
  // phone, and which recurring duties run at all (0151).
  routing: { fn: 'hq_routing' },
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
  portfolio_tasks: { fn: 'hq_portfolio_tasks', args: { p_limit: 200 } },
  /*
    What the office learned, what it wants, what it noticed and what each agent
    could not do (#54, migration 0302).

    Its own section rather than a field on `studio`, for the reason `lately`
    and `portfolio_tasks` are: it reads four tables nobody else on the first
    paint touches, and governance is a screen you navigate TO.
  */
  governance: { fn: 'hq_governance', args: { p_limit: 40 } },
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
    args: { p_limit: 12 },
    textArg: { param: 'q', arg: 'p_query' },
    scoped: true,
  },
  /*
    Everything an object relates to, both directions (#29, migrations 0310-11).

    Takes two arguments where every other section takes at most one, so it uses
    `arg` for the id and `textArg` for the kind — the kind is a short word from
    a fixed vocabulary, and the RPC's own CHECK constraint is what validates it
    rather than a second copy of the list here.
  */
  relations: { fn: 'relations_of', arg: 'p_id', textArg: { param: 'kind', arg: 'p_kind' } },
  /** The named actions, so no page hard-codes them (#27). */
  actions: { fn: 'asset_actions' },
  /*
    How the home screen is arranged (#219, migration 0376).

    Its own section rather than a field on `studio`, because it is read once on
    the way in and written whenever a panel moves - and folding it into the
    payload every project switch carries would make a drag on the home board a
    reason to re-read every project.
  */
  workspace: { fn: 'hq_workspace_layout' },
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
  thinking: { fn: 'office_health' },
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
  unseen: { fn: 'studio_unseen' },
  // What each agent has actually done lately (#155, 0385).
  team_work: { fn: 'studio_team_work' },
  plane: { fn: 'studio_plane', arg: 'p_project_id' },
  plane_layout: { fn: 'hq_plane_layout', arg: 'p_project_id' },
  project_team: { fn: 'project_team', arg: 'p_project_id' },
  project_automations: { fn: 'project_automations', arg: 'p_project_id' },
  /*
    The whole project, as the neutral package §13 names.

    Deliberately its own section and never part of another: 338KB for Legacy
    Coaching Course today, and it grows with the corpus. It is fetched when
    Grant presses Export and at no other time.
  */
  project_export: { fn: 'project_export', arg: 'p_project_id' },
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
const ACTIONS: Readonly<Record<string, { fn: string; required: readonly string[] }>> = {
  // `p_force` is optional and deliberately not required: without it the RPC
  // returns the candidates and creates nothing (0153), which is the behaviour
  // every caller should get by default. Passing it is a person having looked at
  // those candidates and said "no, a new one".
  create_project: { fn: 'hq_create_project', required: ['p_name', 'p_connector', 'p_ref'] },
  rename_project: { fn: 'hq_rename_project', required: ['p_slug', 'p_name'] },
  attach: { fn: 'hq_attach', required: ['p_slug', 'p_connector', 'p_ref'] },
  detach: { fn: 'hq_detach', required: ['p_attachment_id'] },
  // Recording that a project deliberately has no Notion page — §3's fifth
  // option, and the only one that does not end in an attachment. `p_reason` is
  // optional because "not now" is a complete answer on its own.
  connection_choose: {
    fn: 'hq_connection_choose',
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
  retry_send: { fn: 'retry_job_deliveries', required: ['p_job_id'] },
  // Editing a person, and retiring one. There is no delete and there will not
  // be: outputs, routing decisions and deliveries all name a staff member, and
  // a roster that can lose a row is a history that stops explaining itself.
  staff_update: { fn: 'hq_staff_update', required: ['p_slug'] },
  // Withdrawing a written-down procedure (#50). On the configuring side of the
  // line: `skills` is append-only, so this writes a retirement row rather than
  // removing anything, and writing the procedure again undoes it. `p_reason` is
  // optional — the RPC supplies an honest default rather than an empty string.
  retire_skill: { fn: 'hq_retire_skill', required: ['p_skill_id'] },
  // How much the office does without asking (#15). Its own action rather than a
  // `set_setting` key: it lives in `autonomy_settings`, it is scoped — a project
  // can override the global — and every change is a new row so "when did it
  // start acting on its own" stays answerable.
  autonomy_set: { fn: 'hq_autonomy_set', required: ['p_level'] },
  // Per-person tool grants. Never a way past tool_permissions: the RPC ANDs
  // the two, and refuses a grant for a globally disabled tool (§11).
  staff_tool_set: { fn: 'hq_staff_tool_set', required: ['p_slug', 'p_tool', 'p_granted'] },
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
  task_add: { fn: 'hq_task_add', required: ['p_project', 'p_title'] },
  // Contacts (#24, #99). A name and a project; everything else — role, org,
  // email, phone, Instagram, website, kind, note — is optional, because a form
  // that demands nine fields before it will take "Ben, referrer" is a form
  // people route around.
  contact_add: { fn: 'hq_contact_add', required: ['p_project', 'p_name'] },
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
  contact_label_add: { fn: 'hq_contact_label_add', required: ['p_name'] },
  contact_label_rename: { fn: 'hq_contact_label_rename', required: ['p_label_id', 'p_name'] },
  contact_label_remove: { fn: 'hq_contact_label_remove', required: ['p_label_id'] },
  contact_labels_set: { fn: 'hq_contact_labels_set', required: ['p_contact_id', 'p_labels'] },
  contact_fields_set: { fn: 'hq_contact_fields_set', required: ['p_contact_id', 'p_fields'] },
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
  answer_blocker: { fn: 'hq_answer_blocker', required: ['p_blocker_id', 'p_answer'] },
  // `p_reason` is optional here and required by the RPC when the state is
  // `blocked` — the schema's own check constraint, said in a sentence.
  task_state: { fn: 'hq_task_state', required: ['p_task_id', 'p_state'] },
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
  dashboard_layout_set: { fn: 'hq_dashboard_layout_set', required: ['p_slug', 'p_panels'] },
  dashboard_layout_reset: { fn: 'hq_dashboard_layout_reset', required: ['p_slug'] },
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
  workspace_layout_set: { fn: 'hq_workspace_layout_set', required: ['p_panels'] },
  workspace_layout_reset: { fn: 'hq_workspace_layout_reset', required: [] },
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
    required: ['p_project_id', 'p_at', 'p_view'],
  },
  plane_layout_reset: { fn: 'hq_plane_layout_reset', required: ['p_project_id'] },
  project_seen: { fn: 'hq_project_seen', required: ['p_project_id'] },
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
  document_move: { fn: 'hq_document_move', required: ['p_document_id', 'p_project_id'] },
  document_supersede: {
    fn: 'hq_document_supersede',
    required: ['p_document_id', 'p_by_document_id'],
  },
  // `p_state` optional: an undo carries the state the document was in, and a
  // press of "this one is current again" carries nothing and means approved.
  document_restore: { fn: 'hq_document_restore', required: ['p_document_id'] },
  document_pin: { fn: 'hq_document_pin', required: ['p_document_id', 'p_pinned'] },
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
    required: ['p_bot_token', 'p_signing_secret'],
  },
  // The way back out. There was a way in and none out, which made a consent
  // granted through a browser effectively permanent from this page's side.
  forget_google: { fn: 'hq_forget_google', required: [] },
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
  disconnect: { fn: 'hq_disconnect', required: ['p_service'] },
  /*
    How a dashboard project looks (#83, migration 0253).

    Only the slug is required: every other argument is an edit, and `p_clear`
    is how a caller says "remove this" — null cannot mean both "leave it" and
    "take it away". The image arrives as a data URL already resized to 256px by
    the page; the RPC caps it at 96 KB, which can only be exceeded if that
    resize did not run and is worth refusing loudly rather than storing.
  */
  project_look: { fn: 'hq_project_look', required: ['p_slug'] },
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
  task_update: { fn: 'hq_task_update', required: ['p_task_id'] },
  // One setter over three kinds of routing change, allow-listed inside the
  // function for the same reason `set_setting` is: the page is not the only
  // possible caller.
  routing_set: { fn: 'hq_routing_set', required: ['p_what', 'p_value'] },
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
  undo: { fn: 'hq_undo', required: ['p_action_id'] },
  reattach: { fn: 'hq_reattach', required: ['p_attachment_id'] },
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
  say: { fn: 'say_in_project', required: ['p_project_id', 'p_text'] },
  send_to_agent: { fn: 'send_to_agent', required: ['p_kind', 'p_id', 'p_action'] },
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
  output_import: { fn: 'import_output', required: ['p_output'] },
  output_decide: { fn: 'decide_output', required: ['p_output', 'p_verdict'] },
  document_approve: { fn: 'approve_document', required: ['p_document'] },
  document_discard: { fn: 'discard_document', required: ['p_document'] },
  document_rename: { fn: 'rename_document', required: ['p_document', 'p_title'] },
  document_tag: { fn: 'tag_document', required: ['p_document', 'p_tag'] },
  collection_put: { fn: 'put_in_collection', required: ['p_document', 'p_collection_name'] },
  collection_take: { fn: 'take_out_of_collection', required: ['p_document', 'p_collection_name'] },
  reference_add: { fn: 'add_project_reference', required: ['p_slug', 'p_url'] },
  reference_remove: { fn: 'remove_project_reference', required: ['p_reference_id'] },
  lesson_retract: { fn: 'retract_lesson', required: ['p_lesson_id'] },
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
  suggestion_decide: { fn: 'decide_suggestion', required: ['p_suggestion_id', 'p_accept'] },
  proposal_decide: { fn: 'decide_proposal', required: ['p_proposal_id', 'p_state'] },
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
  project_staff: { fn: 'set_project_staff', required: ['p_slug', 'p_staff_slug', 'p_on'] },
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
  project_instruction: { fn: 'set_project_instruction', required: ['p_slug', 'p_staff_slug'] },
  automation_create: { fn: 'create_automation', required: ['p_slug', 'p_instruction'] },
  automation_set: { fn: 'set_automation', required: ['p_automation', 'p_on'] },
  automation_remove: { fn: 'remove_automation', required: ['p_automation'] },
  project_archive: { fn: 'archive_project', required: ['p_slug'] },
  project_unarchive: { fn: 'unarchive_project', required: ['p_slug'] },
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

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return json({ ok: true })

  if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/health')) {
    // Deliberately says nothing about configuration beyond whether a token is
    // present at all. An unauthenticated caller learning which sections exist
    // is a probing aid.
    return json({ ok: true, endpoint: 'hq-api', token_configured: HQ_TOKEN !== '' })
  }

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!(await tokenMatches(presented))) {
    return json({ error: 'unauthorized' }, 401)
  }

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
    const args = (body.args ?? {}) as Record<string, unknown>
    const missing = action.required.filter(
      (k) => args[k] === undefined || args[k] === null || String(args[k]).trim() === '',
    )
    if (missing.length > 0) {
      return json({ error: `missing: ${missing.join(', ')}` }, 400)
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
    return json({ action: actionName, result: await done.json() })
  }

  const url = new URL(request.url)
  const name = url.searchParams.get('section') ?? 'overview'
  // `Object.hasOwn`, not a bare lookup. `SECTIONS['constructor']` and
  // `SECTIONS['__proto__']` are both truthy through the prototype chain, so a
  // bare `!== undefined` let three inherited names past the guard and on to a
  // fetch of `/rpc/undefined` with the service key. Nothing came back and
  // nothing leaked — but the comment above says "a section not named here does
  // not exist", and until now that was not true.
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
  if (name === 'document' && typeof data?.path === 'string' && data.path !== '') {
    const signed = await fetch(`${DB_URL}/storage/v1/object/sign/files/${data.path}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 600 }),
    })
    if (signed.ok) {
      const { signedURL } = (await signed.json()) as { signedURL?: string }
      if (signedURL) data.url = `${DB_URL}/storage/v1${signedURL}`
    } else {
      // Not fatal: the reader falls back to the text, which is usually there.
      console.error(`hq-api document: could not sign (${String(signed.status)})`)
    }
    data.path = undefined
  }

  return json({ section: name, data })
})
