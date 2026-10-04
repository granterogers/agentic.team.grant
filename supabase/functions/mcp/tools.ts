/**
 * The MCP tool catalogue, as pure data and pure functions.
 *
 * Kept out of `index.ts` because that file starts a server on import (`Deno.serve`) and so cannot be unit tested;
 * everything here is plain TypeScript with no Deno API, so `tests/mcp/tools.test.ts` imports it directly. Adding a
 * tool is adding an entry below; which scope it needs, whether it is optional and how the model's arguments become an
 * RPC's are all declared here and checked there.
 */

export const clampInt = (v: unknown, dflt: number, lo: number, hi: number): number => {
  if (v === undefined || v === null || v === '') return dflt
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, Math.trunc(n)))
}

/** `YYYY-MM-DD` that round-trips, else null (the database then refuses nothing and sets nothing). */
export const isoDate = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v.trim())
  if (m === null) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.toISOString().slice(0, 10) === v.trim() ? v.trim() : null
}

export const isoInstant = (v: unknown): string | null => {
  if (typeof v !== 'string' || v.trim() === '') return null
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

export interface ToolSpec {
  readonly description: string
  readonly fn: string
  readonly schema: Record<string, unknown>
  /**
   * `write` tools require the scope. Declared per tool rather than inferred
   * from the name, because "does this change anything" is the one property
   * that must never be a guess about a string.
   */
  readonly write?: boolean
  /**
   * Served only where the database reports it can (`mcp_optional_tools`). The calendar is the first: it is built
   * on a sibling migration, and a tool the deployment cannot perform must not be advertised.
   */
  readonly optional?: boolean
  readonly args: (input: Record<string, unknown>, clientId: string) => Record<string, unknown>
}

/**
 * The complete list. A tool not named here does not exist.
 *
 * Descriptions are written for a model that has never seen this system: they
 * say what the thing IS in this project's terms, because a model that does not
 * know what a "project" means here will use the wrong tool confidently.
 */
export const TOOLS: Readonly<Record<string, ToolSpec>> = {
  list_projects: {
    description:
      'List the active projects the AI team is attached to. A project is the ' +
      'unit of work here: it owns documents and jobs. Start here when you do ' +
      'not know which project a question is about.',
    fn: 'mcp_projects',
    schema: { type: 'object', properties: {} },
    args: () => ({}),
  },
  search_documents: {
    description:
      'Full-text search across every document the team holds, whatever tool it ' +
      'came from (NotebookLM, Notion, uploads). Returns ranked snippets. This ' +
      'is the main way to answer a question about what the team knows — prefer ' +
      'it over guessing, and cite the documents it returns.',
    fn: 'mcp_search',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A question or phrase in plain language.' },
        project: { type: 'string', description: 'Optional project slug to narrow to.' },
        limit: { type: 'number', description: 'Max results, 1-25. Default 8.' },
      },
      required: ['query'],
    },
    args: (i) => ({
      p_query: String(i.query ?? ''),
      p_project: i.project === undefined ? null : String(i.project),
      p_limit: i.limit === undefined ? 8 : Number(i.limit),
    }),
  },
  read_document: {
    description:
      'Read one document in full, by the id search_documents returned. Long ' +
      'documents are truncated and say so.',
    fn: 'mcp_document',
    schema: {
      type: 'object',
      properties: {
        document_id: { type: 'string', description: 'The uuid from search_documents.' },
        max_chars: { type: 'number', description: 'Truncation budget, 1000-60000.' },
      },
      required: ['document_id'],
    },
    args: (i) => ({
      p_document_id: String(i.document_id ?? ''),
      p_max_chars: i.max_chars === undefined ? 20_000 : Number(i.max_chars),
    }),
  },
  list_staff: {
    description:
      'The AI team roster: who exists, their titles and what each is ' +
      'responsible for. Use it to attribute work or to say who would handle ' +
      'something.',
    fn: 'mcp_staff',
    schema: { type: 'object', properties: {} },
    args: () => ({}),
  },
  recent_work: {
    description:
      'What the team recently produced, with its provenance — confidence, ' +
      'evidence type, whether it was reviewed, and which sources it used. ' +
      'Evidence "inferred" means a model wrote it; do not present it as fact.',
    fn: 'mcp_recent_work',
    schema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'Max items, 1-50. Default 20.' } },
    },
    args: (i) => ({ p_limit: i.limit === undefined ? 20 : Number(i.limit) }),
  },

  // --- writing -------------------------------------------------------------
  //
  // Three verbs and no more. A client cannot delete, cannot edit an existing
  // document, and cannot change a project's configuration. Adding is
  // recoverable in one statement by a human; editing and deleting are not, and
  // a general-purpose model's judgement about what is irreversible is worse
  // than its reach.

  add_to_project: {
    description:
      'Save text into a project as a document — a decision, a summary, a set ' +
      'of notes from this conversation. It becomes searchable immediately and ' +
      'is attributed to this client. Identical content is not added twice. Use ' +
      'this when the user says to put something in the project.',
    fn: 'mcp_add_document',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug, from list_projects.' },
        title: { type: 'string', description: 'A short descriptive title.' },
        content: { type: 'string', description: 'The text to save, in full.' },
      },
      required: ['project', 'title', 'content'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_title: String(i.title ?? ''),
      p_content: String(i.content ?? ''),
    }),
  },

  notebook_generate: {
    description:
      "Ask NotebookLM to generate something from a project's notebook: an " +
      'audio overview, slide deck, video, mind map, report, infographic, quiz, ' +
      'flashcards or study guide. These take minutes, so this returns a job id ' +
      'immediately — call check_job with it. Requires the project to have a ' +
      'notebook attached.',
    fn: 'mcp_enqueue',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug, from list_projects.' },
        kind: {
          type: 'string',
          enum: [
            'audio',
            'slides',
            'video',
            'mindmap',
            'report',
            'infographic',
            'quiz',
            'flashcards',
            'study_guide',
          ],
        },
        instructions: {
          type: 'string',
          description: 'Optional steer, e.g. "two minutes, focus on the risks".',
        },
      },
      required: ['project', 'kind'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_kind: 'notebook.generate',
      p_payload: {
        kind: String(i.kind ?? ''),
        instructions: i.instructions === undefined ? null : String(i.instructions),
      },
    }),
  },

  push_to_notebook: {
    description:
      "Copy a document from the project's corpus into its NotebookLM notebook, " +
      'so the notebook can generate from it. Returns a job id; call check_job.',
    fn: 'mcp_enqueue',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        document_id: { type: 'string', description: 'From search_documents.' },
      },
      required: ['project', 'document_id'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_kind: 'notebook.push_document',
      p_payload: { document_id: String(i.document_id ?? '') },
    }),
  },

  ask_notebook: {
    description:
      "Ask NotebookLM a question about a project's notebook sources. It answers " +
      'with citations into those sources, which is different from ' +
      'search_documents — that searches our own cached copies. Returns a job ' +
      'id; call check_job.',
    fn: 'mcp_enqueue',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string' },
        question: { type: 'string' },
      },
      required: ['project', 'question'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_kind: 'notebook.ask',
      p_payload: { question: String(i.question ?? '') },
    }),
  },

  check_job: {
    description:
      'The state of a job started by notebook_generate, push_to_notebook or ' +
      'ask_notebook, and its output when it has finished.',
    fn: 'mcp_job_status',
    schema: {
      type: 'object',
      properties: { job_id: { type: 'string' } },
      required: ['job_id'],
    },
    args: (i) => ({ p_job_id: String(i.job_id ?? '') }),
  },
  // --- the project, worked by an assistant (0920-0922) -------------------------
  //
  // Every one of these takes the office from the CLIENT's credential, never from the model, and every write is
  // recorded as the client's own door ("via ChatGPT"), never as Team HQ. Nothing can delete.

  search_project: {
    description:
      'Search EVERYTHING one project holds with one query: its documents, tasks, conversation, saved ' +
      "webpages, Post-its, calendar events and the team's research. Returns typed results " +
      '(kind, title, snippet, project, score). Prefer it over search_documents when the question is about a ' +
      'project rather than about the corpus.',
    fn: 'mcp_project_search',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A question or phrase in plain language.' },
        project: {
          type: 'string',
          description: 'Project slug from list_projects. Omit to search every project.',
        },
        kinds: {
          type: 'string',
          description:
            'Optional comma list to narrow: document, source, page, task, message, answer, research, postit, event.',
        },
        limit: { type: 'number', description: 'Max results, 1-50. Default 10.' },
      },
      required: ['query'],
    },
    args: (i) => ({
      p_query: String(i.query ?? ''),
      p_project: i.project === undefined ? null : String(i.project),
      p_kinds: i.kinds === undefined ? null : String(i.kinds),
      p_limit: clampInt(i.limit, 10, 1, 50),
    }),
  },

  list_tasks: {
    description:
      'List the tasks of a project (or of every project): title, state, due date, what a blocked task is waiting ' +
      'on. Cancelled tasks are not listed.',
    fn: 'mcp_list_tasks',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug. Omit for every project.' },
        state: {
          type: 'string',
          enum: ['open', 'todo', 'doing', 'blocked', 'done'],
          description: 'open = todo, doing or blocked.',
        },
        limit: { type: 'number', description: 'Max tasks, 1-100. Default 25.' },
      },
    },
    args: (i) => ({
      p_project: i.project === undefined ? null : String(i.project),
      p_state: i.state === undefined ? null : String(i.state),
      p_limit: clampInt(i.limit, 25, 1, 100),
    }),
  },

  create_task: {
    description:
      'Add a task to a project. It is attributed to this assistant ("via ChatGPT" / "via Claude") in the ' +
      "project's Activity. Use it when the user asks to put a to-do on a project.",
    fn: 'mcp_task_add',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug, from list_projects.' },
        title: { type: 'string', description: 'A short imperative title.' },
        detail: { type: 'string' },
        due_on: { type: 'string', description: 'Optional due date, YYYY-MM-DD.' },
      },
      required: ['project', 'title'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_title: String(i.title ?? ''),
      p_detail: i.detail === undefined ? null : String(i.detail),
      p_due_on: isoDate(i.due_on),
    }),
  },

  update_task: {
    description:
      'Change a task: its state (todo, doing, blocked, done), title, detail or due date. A blocked task needs ' +
      "`blocked_reason`. It cannot cancel or delete a task - taking work back is the owner's to do.",
    fn: 'mcp_task_update',
    write: true,
    schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: 'The id from list_tasks.' },
        state: { type: 'string', enum: ['todo', 'doing', 'blocked', 'done'] },
        title: { type: 'string' },
        detail: { type: 'string' },
        due_on: { type: 'string', description: 'YYYY-MM-DD.' },
        blocked_reason: { type: 'string', description: 'Required when state is blocked.' },
      },
      required: ['task_id'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_task_id: String(i.task_id ?? ''),
      p_state: i.state === undefined ? null : String(i.state),
      p_title: i.title === undefined ? null : String(i.title),
      p_detail: i.detail === undefined ? null : String(i.detail),
      p_due_on: isoDate(i.due_on),
      p_blocked_reason: i.blocked_reason === undefined ? null : String(i.blocked_reason),
    }),
  },

  // Calendar: served only where the database has the calendar (see OPTIONAL_TOOLS). Argument names follow the
  // contract documented in migration 0922 - one place to correct if 0897 differs.
  list_events: {
    description: 'List calendar events of a project (or of every project) between two instants.',
    fn: 'mcp_event_list',
    optional: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug. Omit for every project.' },
        from: { type: 'string', description: 'ISO 8601 instant. Default: now.' },
        to: { type: 'string', description: 'ISO 8601 instant.' },
        limit: { type: 'number', description: 'Max events, 1-100. Default 25.' },
      },
    },
    args: (i) => ({
      p_project: i.project === undefined ? null : String(i.project),
      p_from: isoInstant(i.from),
      p_to: isoInstant(i.to),
      p_limit: clampInt(i.limit, 25, 1, 100),
    }),
  },
  create_event: {
    description: 'Add a calendar event to a project. Attributed to this assistant in Activity.',
    fn: 'mcp_event_create',
    write: true,
    optional: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug.' },
        title: { type: 'string' },
        starts_at: { type: 'string', description: 'ISO 8601 instant, with a timezone offset.' },
        ends_at: { type: 'string', description: 'ISO 8601 instant.' },
        location: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['project', 'title', 'starts_at'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_title: String(i.title ?? ''),
      p_starts_at: isoInstant(i.starts_at),
      p_ends_at: isoInstant(i.ends_at),
      p_location: i.location === undefined ? null : String(i.location),
      p_notes: i.notes === undefined ? null : String(i.notes),
    }),
  },
  update_event: {
    description:
      'Change a calendar event: title, time, location or notes. It cannot delete an event.',
    fn: 'mcp_event_update',
    write: true,
    optional: true,
    schema: {
      type: 'object',
      properties: {
        event_id: { type: 'string', description: 'The id from list_events.' },
        title: { type: 'string' },
        starts_at: { type: 'string' },
        ends_at: { type: 'string' },
        location: { type: 'string' },
        notes: { type: 'string' },
      },
      required: ['event_id'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_event_id: String(i.event_id ?? ''),
      p_title: i.title === undefined ? null : String(i.title),
      p_starts_at: isoInstant(i.starts_at),
      p_ends_at: isoInstant(i.ends_at),
      p_location: i.location === undefined ? null : String(i.location),
      p_notes: i.notes === undefined ? null : String(i.notes),
    }),
  },

  inspect_activity: {
    description:
      'What happened lately, and through which door: each entry says who did it, what, when, "via" which interface ' +
      '(Team HQ, ChatGPT, Claude, Telegram, Slack, a sync - or null when it was not recorded) and a category ' +
      '(task, document, calendar, sync, research, other). Pass a project slug for one project, omit for the whole office.',
    fn: 'mcp_activity',
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug. Omit for the whole office.' },
        limit: { type: 'number', description: 'Max entries, 1-100. Default 25.' },
      },
    },
    args: (i) => ({
      p_project: i.project === undefined ? null : String(i.project),
      p_limit: clampInt(i.limit, 25, 1, 100),
    }),
  },

  ask_team: {
    description:
      'Put a question or a request to the AI team inside a project - optionally to one named specialist from ' +
      'list_staff. Returns a job id; call check_job to read the answer. The team may think, answer and draft; it ' +
      'will not act outside Team HQ on a request that arrives this way.',
    fn: 'mcp_ask_team',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug.' },
        question: {
          type: 'string',
          description: 'The question or request, in full (max 4000 characters).',
        },
        to: { type: 'string', description: 'Optional staff slug, e.g. research-director.' },
      },
      required: ['project', 'question'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_text: String(i.question ?? ''),
      p_to: i.to === undefined ? null : String(i.to),
    }),
  },

  start_research: {
    description:
      'Ask the research director to investigate a topic for a project, optionally starting from one https page. ' +
      "The owner's autonomy policy decides: if it says the owner must approve, NOTHING is started and the reply says " +
      '"needs_approval" with the reason. Returns a job id when it starts; call check_job.',
    fn: 'mcp_start_research',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug.' },
        topic: { type: 'string' },
        url: { type: 'string', description: 'Optional https page to start from.' },
      },
      required: ['project', 'topic'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_topic: String(i.topic ?? ''),
      p_url: i.url === undefined ? null : String(i.url),
    }),
  },

  generate_artifact: {
    description:
      'Have the team write a report from what a project holds, saved into the project as a document (PDF). The ' +
      "owner's autonomy policy decides: if it says the owner must approve, nothing is started and the reply says " +
      '"needs_approval". Returns a job id when it starts; call check_job.',
    fn: 'mcp_generate_artifact',
    write: true,
    schema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project slug.' },
        brief: {
          type: 'string',
          description: 'What the report should cover (max 2000 characters).',
        },
      },
      required: ['project', 'brief'],
    },
    args: (i, clientId) => ({
      p_client_id: clientId,
      p_project: String(i.project ?? ''),
      p_brief: String(i.brief ?? ''),
    }),
  },
}

/** Which tools a client sees: optional tools only where the database serves them. */
export const visibleTools = (
  optionalAvailable: readonly string[],
): readonly (readonly [string, ToolSpec])[] =>
  Object.entries(TOOLS).filter(
    ([name, spec]) => spec.optional !== true || optionalAvailable.includes(name),
  )

/** The scope a tool needs: write tools need `write`; everything else needs only a valid client. */
export const scopeRefusal = (spec: ToolSpec, scopes: readonly string[]): string | null =>
  spec.write === true && !scopes.includes('write')
    ? 'needs the write scope; this client is read-only'
    : null

/** Whether the model named a tool the catalogue holds (own properties only: `constructor` is not a tool). */
export const toolNamed = (name: string): ToolSpec | undefined =>
  Object.hasOwn(TOOLS, name) ? TOOLS[name] : undefined

/**
 * The arguments an RPC receives. The office is written by the CALLER from the client's credential and is placed
 * FIRST so nothing in the model's input can override it; a model-supplied `p_office` (or any key the tool does not
 * declare) never reaches the database, because every mapper reads named fields only.
 */
export const rpcArgs = (
  spec: ToolSpec,
  office: string,
  clientId: string,
  input: Record<string, unknown>,
): Record<string, unknown> => ({ ...spec.args(input, clientId), p_office: office })
