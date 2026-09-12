/**
 * Putting a project's source material into Notion, as Projects, Tasks and Docs.
 *
 * ## Why this exists
 *
 * Grant, looking at an empty teamspace after a day of me reporting progress:
 * *"notion is still empty.. you need to check against the results of what im
 * asking."*
 *
 * He was right, and the criticism is the useful part. Every capability had been
 * built — create a page, append blocks, set a relation, upload a file, avoid a
 * duplicate — and each was verified. Nothing composed them. The Chief of Staff
 * could describe an import and could not perform one, so every brief came back
 * as prose, and I kept reporting green checks against a workspace with nothing
 * in it.
 *
 * A capability is not a result.
 *
 * ## What is deterministic and what is not
 *
 * The **documents** are deterministic and carry most of the value: one Notion
 * page per source we hold, with its real content, structured. Twelve sources
 * become twelve readable pages whatever else happens, and that requires no
 * model at all.
 *
 * The **curriculum** — which modules exist, what tasks follow — needs judgement,
 * so a model proposes it. Its output is validated hard and falls back to a
 * structure derived from the source titles, because this runs on a free tier
 * and a malformed answer must not mean an empty teamspace. The fallback is not
 * a stub: source documents in a course are usually modules already, which is
 * exactly what WS01 and WS02 are.
 *
 * ## Idempotent because it will be run twice
 *
 * It will fail halfway, or he will ask again. Every page is matched on
 * normalised title within its data source and left alone if it exists — not
 * updated, because a rerun must not overwrite an edit he made in between.
 */

import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import { NotionClient } from '../notion/api.ts'
import { type Schema, schemaOf } from '../notion/structure.ts'
import { registerAuthored } from '../notion/sync.ts'
import { appendBlocks, createPageIfAbsent, relate, toBlocks } from '../notion/write.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { count } from '../text/plain.ts'
import { scrub } from '../text/scrub.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/**
 * The property that points at the Projects data source.
 *
 * A Docs database here has relations to more than one thing, and the first one
 * Notion happens to list is not necessarily the module. Matched on what the
 * relation actually points at, falling back to the first relation only when
 * nothing points at Projects — which is better than relating to the wrong
 * database and quietly filling in the wrong column.
 */
const relationTo = (schema: Schema, target: string | undefined): string | null => {
  const relations = schema.properties.filter((p) => p.type === 'relation')
  if (target !== undefined) {
    const exact = relations.find((p) => p.relatesTo === target)
    if (exact !== undefined) return exact.name
  }
  return relations[0]?.name ?? null
}

interface Module {
  readonly name: string
  readonly summary: string
  readonly tasks: readonly string[]
  /** Titles of the source documents this module is built from. */
  readonly sources: readonly string[]
}

interface SourceDoc {
  readonly title: string
  readonly content: string
}

export interface NotionImportDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter | null
}

export function notionImportHandler(deps: NotionImportDeps): Handler {
  const { db, router } = deps
  return {
    kind: 'office.notion_import',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        path: 'deterministic_retrieval' as const,
        model: null,
      }
      const say = (body: string, announce = true): HandlerOutput =>
        ({ ...base, body, announce }) satisfies HandlerOutput

      if (job.projectId === null || job.projectId === undefined) {
        return say('I do not know which project to import. Say which one.')
      }

      // --- where it goes ----------------------------------------------------
      const setup = (
        await db.execute(`
          select
            (select decrypted_secret from vault.decrypted_secrets
              where name = 'notion.integration_token') as token,
            (select name from public.projects
              where project_id = ${lit(job.projectId)}::uuid) as project_name,
            (select jsonb_object_agg(a.artifact_kind, a.external_ref)
               from public.project_attachments a
              where a.project_id = ${lit(job.projectId)}::uuid
                and a.connector = 'notion' and a.enabled and a.role = 'home') as targets
        `)
      ).rows[0] as {
        token?: string | null
        project_name?: string | null
        targets?: Record<string, string> | null
      }

      const token = String(setup.token ?? '')
      const targets = setup.targets ?? {}
      const projectName = String(setup.project_name ?? 'this project')
      if (token === '') return say('There is no Notion token in the vault.')

      const docsDb = targets.document
      const projectsDb = targets.artifact
      const tasksDb = targets.task
      if (docsDb === undefined && projectsDb === undefined) {
        return say(
          `${projectName} has no Notion databases attached, so there is nowhere to put ` +
            'this. Say "wire this up to Notion" and I will attach what is shared.',
        )
      }

      // --- what there is to import -----------------------------------------
      const sources = (
        await db.execute(`
          select title, coalesce(content, '') as content
            from public.documents
           where project_id = ${lit(job.projectId)}::uuid
             and coalesce(content, '') <> ''
           order by content_chars desc
        `)
      ).rows.map((r) => ({ title: String(r.title), content: String(r.content) }))

      if (sources.length === 0) {
        return say(
          `${projectName} has no source material read in yet, so there is nothing to import.`,
        )
      }

      const client = new NotionClient(token)
      const modules = await curriculum(router, projectName, sources)

      const made = { projects: 0, tasks: 0, docs: 0 }
      const existed = { projects: 0, tasks: 0, docs: 0 }
      const links: string[] = []

      // --- the modules, as Notion Projects ----------------------------------
      const projectPageFor = new Map<string, string>()
      if (projectsDb !== undefined) {
        const schema = await schemaOf(client, projectsDb)
        for (const module of modules) {
          const body = `${module.summary}\n\n## Built from\n\n${module.sources.map((s) => `- ${s}`).join('\n')}`
          const page = await createPageIfAbsent(client, {
            parent: { dataSource: projectsDb },
            title: module.name,
            titleProperty: schema.titleProperty,
            body,
          })
          projectPageFor.set(module.name, page.id)
          /*
            #20. A module page is the office's OUTPUT, and `duty:notion-sync`
            reads it straight back — so without this it lands in the corpus
            looking exactly like something Grant supplied. Six of them did.

            Recorded here, in the pass that writes the page, rather than
            recognised afterwards: 0169 makes the same point about
            `mirrors_document_id`, and for the same reason — a title Grant
            edits in Notion stops matching, and the row quietly becomes source
            material again.

            Also on the `existed` branch, because a rerun against a page an
            earlier run created is exactly how the six unmarked rows happened.
          */
          await registerAuthored(
            db,
            job.projectId,
            { id: page.id, title: module.name },
            body,
            'office.notion_import',
          )
          if (page.existed) existed.projects += 1
          else {
            made.projects += 1
            if (page.url !== '') links.push(`${module.name} — ${page.url}`)
          }
        }
      }

      // --- the source material, as Docs -------------------------------------
      //
      // The deterministic half, and the one that carries the content. Related
      // to the module that cites it, so a reader lands on the module and finds
      // its material rather than a flat list of twelve pages.
      if (docsDb !== undefined) {
        const schema = await schemaOf(client, docsDb)
        const relationProp = relationTo(schema, projectsDb)

        for (const source of sources) {
          const page = await createPageIfAbsent(client, {
            parent: { dataSource: docsDb },
            title: source.title,
            titleProperty: schema.titleProperty,
            // The first chunk goes in with the page; the rest is appended.
            body: source.content.slice(0, 12_000),
          })
          if (page.existed) {
            existed.docs += 1
            continue
          }
          made.docs += 1
          if (source.content.length > 12_000) {
            await appendBlocks(client, page.id, toBlocks(source.content.slice(12_000)))
          }
          const owner = modules.find((m) => m.sources.includes(source.title))
          const ownerPage = owner === undefined ? undefined : projectPageFor.get(owner.name)
          if (relationProp !== null && ownerPage !== undefined) {
            await relate(client, page.id, relationProp, [ownerPage])
          }
        }
      }

      // --- the work that follows, as Tasks ----------------------------------
      if (tasksDb !== undefined) {
        const schema = await schemaOf(client, tasksDb)
        const relationProp = relationTo(schema, projectsDb)

        for (const module of modules) {
          for (const task of module.tasks) {
            const page = await createPageIfAbsent(client, {
              parent: { dataSource: tasksDb },
              title: task,
              titleProperty: schema.titleProperty,
            })
            if (page.existed) {
              existed.tasks += 1
              continue
            }
            made.tasks += 1
            const ownerPage = projectPageFor.get(module.name)
            if (relationProp !== null && ownerPage !== undefined) {
              await relate(client, page.id, relationProp, [ownerPage])
            }
          }
        }
      }

      // --- what happened ----------------------------------------------------
      const created: string[] = []
      if (made.projects > 0) created.push(count(made.projects, 'Project', 'Projects'))
      if (made.tasks > 0) created.push(count(made.tasks, 'Task', 'Tasks'))
      if (made.docs > 0) created.push(count(made.docs, 'Doc', 'Docs'))

      const already = existed.projects + existed.tasks + existed.docs
      const body =
        (created.length === 0
          ? `Everything was already there — ${String(already)} pages, nothing duplicated.`
          : `Created ${created.join(', ')} in Notion for ${projectName}.` +
            (already === 0 ? '' : ` ${String(already)} already existed and were left alone.`)) +
        (modules.length === 0 ? '' : `\n\nModules: ${modules.map((m) => m.name).join(', ')}.`) +
        (links.length === 0 ? '' : `\n\n${links.slice(0, 6).join('\n')}`)

      return say(body)
    },
  }
}

/**
 * The curriculum, proposed by a model and validated hard.
 *
 * Strict JSON, because a model asked for prose gives prose and a model asked
 * for JSON usually gives JSON with an apology around it — so the answer is
 * scrubbed, the first brace found, and the shape checked field by field.
 * Anything that does not survive that is discarded in favour of the fallback,
 * because a malformed answer must not mean an empty teamspace.
 */
async function curriculum(
  router: ProviderRouter | null,
  projectName: string,
  sources: readonly SourceDoc[],
): Promise<Module[]> {
  const fallback = (): Module[] =>
    // Source documents in a course are usually modules already — WS01 and WS02
    // are exactly that — so this is a reasonable structure rather than a stub.
    sources.slice(0, 8).map((s) => ({
      name: s.title.replace(/\.(pdf|docx?|txt)$/i, '').slice(0, 90),
      summary: `Built from the source "${s.title}".`,
      tasks: [`Work through ${s.title.replace(/\.(pdf|docx?|txt)$/i, '').slice(0, 70)}`],
      sources: [s.title],
    }))

  if (router === null) return fallback()

  const inventory = sources
    .map((s) => `- ${s.title}\n  ${s.content.slice(0, 700).replace(/\s+/g, ' ')}`)
    .join('\n')

  try {
    const completion = await router.complete({
      messages: [
        {
          role: 'system',
          content:
            'You organise course material into a curriculum. Reply with JSON only — no ' +
            'preamble, no code fence, no commentary.\n\n' +
            'Shape: {"modules":[{"name":"...","summary":"...","tasks":["...","..."],' +
            '"sources":["exact source title","..."]}]}\n\n' +
            'Between three and seven modules. Each name is a short human title. Each ' +
            'summary is one or two sentences. Two to four tasks per module, each one a ' +
            'concrete action starting with a verb. `sources` must contain source titles ' +
            'EXACTLY as given — never invent one.',
        },
        {
          role: 'user',
          content: `Course: ${projectName}\n\nSource material:\n${inventory}`,
        },
      ],
      maxTokens: 2_000,
    })

    const text = scrub(completion.content)
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) return fallback()

    const parsed = JSON.parse(text.slice(start, end + 1)) as { modules?: unknown }
    const titles = new Set(sources.map((s) => s.title))
    const modules = (Array.isArray(parsed.modules) ? parsed.modules : [])
      .map((raw): Module | null => {
        const m = raw as Record<string, unknown>
        const name = String(m.name ?? '').trim()
        if (name === '' || name.length > 120) return null
        return {
          name,
          summary: String(m.summary ?? '')
            .trim()
            .slice(0, 600),
          tasks: (Array.isArray(m.tasks) ? m.tasks : [])
            .map((t) => String(t).trim())
            .filter((t) => t !== '' && t.length <= 160)
            .slice(0, 6),
          // Only titles we actually hold. A hallucinated source would relate a
          // doc that does not exist, or silently relate nothing.
          sources: (Array.isArray(m.sources) ? m.sources : [])
            .map((s) => String(s).trim())
            .filter((s) => titles.has(s)),
        }
      })
      .filter((m): m is Module => m !== null)
      .slice(0, 8)

    return modules.length >= 2 ? modules : fallback()
  } catch {
    return fallback()
  }
}
