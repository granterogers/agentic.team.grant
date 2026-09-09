# Notion: what we can do, what we have not built, and what nobody can

**Generated from `src/notion/capabilities.ts` on 2026-09-09** and verified live
by `npm run verify:notion-write` (20/20). Regenerate by running
`npm run verify:notion-write`, which fails if any row marked `SUPPORTED` stops
being true.

**Connection** — bot `Agentic Team Key` in `Grant Rogers's Space`, API version
**2026-03-11**, six data sources shared.

---

## Why this document exists

The Chief of Staff told Grant she could not create Notion pages, and then, asked
what tooling she had, asked *him*:

> "I can't confirm which Notion write ops are exposed without seeing the
> integration config. Do we have a Notion bot token, workspace ID, and the
> scopes that let us create pages, update blocks, and upload files?"

Every part of that is discoverable from the vault, the tool registry and one
live call. An agent asking a person for configuration the system already holds
is the failure this matrix and `notionCapabilities()` exist to end.

Of the seven explanations Grant listed, **three were true at once**:

- **not implemented in our code** — there was no write path at all;
- **not registered as an agent tool** — `tool_permissions` had no `notion.write`;
- **the API wrapper was incomplete** — the client was pinned to `2022-06-28`,
  which has no file-upload endpoint whatsoever.

The credentials were fine throughout. The token authenticates, has always
authenticated, and `verify:notion` was passing twelve checks against the live
workspace the whole time — **all twelve of them reads**.

---

## The matrix

| Capability | Notion | We support | Credential | Tested | Action |
|---|---|---|---|---|---|
| `search` | yes | ✅ SUPPORTED | ✅ | live | — |
| `retrieve_page` | yes | ✅ SUPPORTED | ✅ | live | — |
| `retrieve_block_children` | yes | ✅ SUPPORTED | ✅ | live | — |
| `list_data_sources` | yes | ✅ SUPPORTED | ✅ | live | — |
| `inspect_schema` | yes | ✅ SUPPORTED | ✅ | live | — |
| `query_data_source` | yes | ✅ SUPPORTED | ✅ | live | — |
| `find_by_title` | yes | ✅ SUPPORTED | ✅ | live | the idempotency key |
| `create_page` | yes | ✅ SUPPORTED | ✅ | live | — |
| `update_page_properties` | yes | ✅ SUPPORTED | ✅ | live | — |
| `append_blocks` | yes | ✅ SUPPORTED | ✅ | live | batched at 100 |
| `update_block` | yes | ✅ SUPPORTED | ✅ | unit | — |
| `archive_page` | yes | ✅ SUPPORTED | ✅ | live | `in_trash`, reversible |
| `archive_block` | yes | ✅ SUPPORTED | ✅ | unit | reversible |
| `set_relation` | yes | ✅ SUPPORTED | ✅ | unit | Task ↔ Project |
| `markdown_to_blocks` | n/a | ✅ SUPPORTED | n/a | unit | ours, not Notion's |
| `upload_file` | yes | ✅ SUPPORTED | ✅ | live | single + multi-part |
| `attach_file_to_block` | yes | ✅ SUPPORTED | ✅ | live | audio/video/image/pdf |
| `attach_file_to_property` | yes | ✅ SUPPORTED | ✅ | unit | — |
| `create_data_source` | yes | ⬜ NOT_IMPLEMENTED | ✅ | — | build if he wants databases made for him |
| `update_schema` | yes | ⬜ NOT_IMPLEMENTED | ✅ | — | changing his schema is his call |
| `comments` | yes | ⬜ NOT_IMPLEMENTED | ✅ | — | nothing needs it yet |
| `list_users` | yes | ⬜ NOT_IMPLEMENTED | needs capability | — | nothing needs it yet |
| `permanent_delete` | **no** | ❌ NOT_SUPPORTED_BY_NOTION | — | — | none possible — and this suits §13 |
| `create_teamspace` | **no** | ❌ NOT_SUPPORTED_BY_NOTION | — | — | Grant creates these; 0163 prompts him |
| `read_teamspace_of_a_page` | **no** | ❌ NOT_SUPPORTED_BY_NOTION | — | — | none possible |

---

## What Notion genuinely cannot do

Established by probing the live API on **2022-06-28**, **2025-09-03** and
**2026-03-11**, not from memory:

**Teamspaces are invisible.** No `/v1/teamspaces` endpoint, no teamspace field
on any object, and a database living inside a teamspace reports
`parent: {type: "workspace"}`. They cannot be created, listed, or read. This is
why `projects.notion_teamspace_name` holds a **name** — there is no id to hold —
and why 0163 prompts Grant to make one by hand for each new project.

**There is no hard delete.** `PATCH` with `in_trash: true` moves a page to the
trash, from which he can restore it. That is the most destructive thing the API
offers, which happens to be exactly the safety property §13 wants.

**A page must be shared to be reachable.** The integration sees only what has
been shared with it, directly or through an ancestor. There is no way to
enumerate the workspace.

---

## Two breaking changes the version bump brought

The client moved from `2022-06-28` to `2026-03-11`. Both of these fail loudly
rather than degrading, and both were found by running into them:

**`archived` became `in_trash`.** `PATCH /pages/:id` with `{archived: true}` is
now rejected outright — *"body.archived should be not present"*. The cleanup
step of `verify:notion` failed on exactly this.

**Databases became data sources.** From `2025-09-03` a database is a container
and the queryable thing inside it is a data source. Search returns
`data_source` objects; pages are parented to a `data_source_id`; queries go to
`/data_sources/:id/query`. Asking `/databases/{a data source id}` is a 404.

Notion's own upgrade guide is explicit that staying on the old version is not
safe indefinitely: the moment a second data source is added to a database, an
old connection's page creation, queries and relations all start failing — a
break caused by something done in the Notion UI, with nothing in our code having
changed.

---

## Safety

- **No delete exists anywhere in `src/notion/`.** Archiving is the strongest
  verb, and it is reversible.
- **`notion.write` is level 2** — §13's "creating external resources: medium
  risk, with confirmation" — beside `notebook.write`. Not level 3, which would
  need approval per page and make the team useless for the work it was asked to
  do; not level 1, which would let it write silently.
- **Reruns do not duplicate.** `createPageIfAbsent` matches on normalised title
  within the target data source and returns the existing page **untouched**, so
  a second run cannot overwrite an edit Grant made in between.
- **Schema is read before writing.** A select value that is not in the
  database's own option list is a validation error an agent cannot interpret, so
  `schemaOf` exposes the options and the real title property name.
- **Limits are checked before the first request.** Unsupported type and
  over-long filename are refused locally with a sentence saying what to do. The
  workspace file-size cap cannot be known locally — free is 5 MiB, paid 5 GiB —
  so that one is caught and translated rather than predicted.
- **Rate limits and transient failures** are handled by `NotionClient`, which
  already retried with backoff and honours `Retry-After`.

---

## What an agent should do instead of asking

```ts
import { notionCapabilities, capabilitySummary } from './src/notion/capabilities.ts'
const caps = await notionCapabilities(db)   // configured? authenticates? which ops?
```

`capabilitySummary(caps)` is one sentence naming every `SUPPORTED` operation and
every impossible one, and it ends: *"Do not tell Grant you are unable to do
something on this list without trying it first."* It is injected into the Chief
of Staff's prompt on every answer, alongside `verbsNow()` — which reads the tool
registry rather than the network, so it costs a query and not a round trip.

The six states exist so that "we cannot do that" always carries its reason:

| State | Meaning |
|---|---|
| `SUPPORTED` | built, permitted, credential works |
| `NOT_IMPLEMENTED` | Notion can; we have not written it |
| `NOT_AUTHORIZED` | built; this team is not permitted it |
| `NOT_CONFIGURED` | built and permitted; no credential |
| `NOT_SUPPORTED_BY_NOTION` | nobody can |
| `UNKNOWN` | could not be determined, and says so |

`NOT_IMPLEMENTED` against `NOT_SUPPORTED_BY_NOTION` is the pair that matters. For
a week "the team cannot upload files to Notion" was true and read as the second
when it was the first — the difference between a morning's work and an
impossibility.

---

## Legacy Coaching Course readiness

Everything the original job needs is now `SUPPORTED`:

| Needed | Status |
|---|---|
| Read the notebook sources | ✅ 12 documents already synced into the project |
| Create the curriculum structure | ✅ `create_page` into the Projects data source |
| Create Projects and Tasks | ✅ `createPageIfAbsent`, no duplicates on a rerun |
| Supporting pages with real structure | ✅ `toBlocks` — headings, lists, checklists, quotes |
| Relations between Tasks and Projects | ✅ `relate`, with `schemaOf` naming the property |
| Attach source assets | ✅ `uploadFile` + `fileBlock`; audio becomes an audio block |
| Avoid duplicates | ✅ normalised title match |

**The one remaining blocker is Grant's**, and it is the one Notion cannot
automate: the Legacy Coaching Course project has no Notion teamspace. Its
connection state reads `wanted` with the reason attached (0163). He creates the
teamspace, adds a database inside it, shares it with the Agentic integration,
and attaches that database to the project — after which the import is entirely
the team's to run.
