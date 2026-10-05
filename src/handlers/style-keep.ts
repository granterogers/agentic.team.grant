/**
 * Saying "use this report's style for this project" (HQ-STYLE-018): the conversation's half.
 *
 * What it does, in order, and what it never does:
 *
 *   1. Finds the project this conversation is in. None: it says so, and changes nothing.
 *   2. Lists the made reports "this one" could mean (`app.style_source_candidates`) and decides with
 *      `chooseStyleSource`: the one this conversation produced, or the only one the project has. Several: it ASKS,
 *      listing them. None: it says so. It never picks one of several.
 *   3. Calls the same function the viewer's button calls (`adoptStyleFromDocument`), without confirmation.
 *   4. Saved: says so. Refused (a report made before its style was recorded, a different project): says so in the
 *      function's own words and that nothing changed.
 *   5. The project already has a style: it does NOT replace it. It raises a question the person can answer by saying
 *      yes or pressing the button, whose answer starts the `style.adopt` job, and says plainly that nothing has
 *      changed yet. Silence, or "no", leaves the style as it was.
 *
 * The body is composed in code, not by a model: it states what happened to a record, and a paraphrase between the
 * person and that fact is where "I've saved it" gets said about something that was not.
 */

import {
  chooseStyleSource,
  type StyleKeep,
  type StyleSourceCandidate,
} from '../agents/style-keep.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { raiseBlocker } from '../inference/record.ts'
import { adoptStyleFromDocument, saidAboutAdoption } from '../style/adopt.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const REPLACE_OPTION = 'Yes, replace the project style'
export const KEEP_OPTION = 'No, keep the current style'

export interface StyleKeepContext {
  readonly jobId: string
  readonly projectId: string | null
  /** The inbound command this turn answers, when there is one (finds the thread). */
  readonly commandId: string | null
  readonly channel: string | null
  /** Who is speaking, as the door recorded them. */
  readonly staffSlug: string
  readonly request: StyleKeep
}

export interface StyleKeepOutcome {
  readonly body: string
  readonly outcome: 'saved' | 'asked_which' | 'asked_to_replace' | 'refused' | 'none' | 'no_project'
  readonly blockerId?: string | undefined
}

const when = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

const rest = (req: StyleKeep): string =>
  req.onlyThat
    ? ''
    : ' That is all I did from your message: the rest of it needs asking again on its own.'

export async function keepStyle(
  db: SqlExecutor,
  ctx: StyleKeepContext,
  raise: typeof raiseBlocker = raiseBlocker,
): Promise<StyleKeepOutcome> {
  if (ctx.projectId === null) {
    return {
      outcome: 'no_project',
      body:
        'I need to know which project this style is for, and this conversation is not in one. ' +
        `Say it from inside the project, or name it, and I will save it.${rest(ctx.request)}`,
    }
  }
  const slug = String(
    (
      (
        await db.execute(`
          select slug from public.projects
           where project_id = ${lit(ctx.projectId)}::uuid and office_id = app.job_office(${lit(ctx.jobId)}::uuid)`)
      ).rows[0] as { slug?: string } | undefined
    )?.slug ?? '',
  )
  if (slug === '') {
    return {
      outcome: 'none',
      body: `I could not find this project, so I saved nothing.${rest(ctx.request)}`,
    }
  }

  const command = ctx.commandId !== null && UUID.test(ctx.commandId) ? ctx.commandId : null
  // A schema without the reader (a worker deployed before the migration) must not fail the turn: say so.
  const rows = await db
    .execute(`
      select app.style_source_candidates(app.job_office(${lit(ctx.jobId)}::uuid), ${lit(slug)},
             ${command === null ? 'null' : `${lit(command)}::uuid`}) as c`)
    .then((r) => r.rows[0] as { c?: unknown } | undefined)
    .catch(() => null)
  if (rows === null) {
    return {
      outcome: 'none',
      body: `I could not look through this project's reports just now, so I saved nothing. Nothing was changed.${rest(ctx.request)}`,
    }
  }
  const raw = typeof rows?.c === 'string' ? (JSON.parse(rows.c) as unknown) : rows?.c
  const candidates: StyleSourceCandidate[] = (Array.isArray(raw) ? raw : []).map((c) => {
    const r = c as Record<string, unknown>
    return {
      documentId: String(r.document_id ?? ''),
      title: String(r.title ?? 'a report'),
      createdAt: String(r.created_at ?? ''),
      inThread: r.in_thread === true,
      hasSnapshot: r.has_snapshot === true,
    }
  })

  const choice = chooseStyleSource(candidates, ctx.request.hint)
  if (choice.kind === 'none') {
    return {
      outcome: 'none',
      body:
        choice.why === 'no_reports'
          ? `There is no report made in this project yet, so there is no style to take from one. Nothing was changed.${rest(ctx.request)}`
          : `I could not find a report here called “${ctx.request.hint ?? ''}”. Nothing was changed.${rest(ctx.request)}`,
    }
  }
  if (choice.kind === 'ask') {
    const list = choice.candidates
      .slice(0, 5)
      .map(
        (c) =>
          `“${c.title}”${c.createdAt === '' ? '' : ` (made ${when(c.createdAt)})`}${
            c.hasSnapshot ? '' : ' — made before styles were recorded, so it cannot be saved'
          }`,
      )
      .join('; ')
    return {
      outcome: 'asked_which',
      body:
        `Which report do you mean? ${list}. Nothing has been changed. ` +
        `Tell me by name, for example “use the ${choice.candidates[0]?.title ?? 'pricing'} report's style for this project”.${rest(ctx.request)}`,
    }
  }

  const picked = choice.candidate
  const by = await db
    .execute(
      `select app.command_principal(app.job_office(${lit(ctx.jobId)}::uuid), ${
        command === null ? 'null' : `${lit(command)}::uuid`
      }) as p`,
    )
    .then((r) => (r.rows[0] as { p?: string | null } | undefined)?.p ?? null)
    .catch(() => null)

  const result = await adoptStyleFromDocument(db, {
    jobId: ctx.jobId,
    slug,
    documentId: picked.documentId,
    confirm: false,
    channel: ctx.channel,
    by,
  })

  if (result.needs_confirmation === true) {
    const blockerId = await raise(db, {
      projectId: ctx.projectId,
      jobId: ctx.jobId,
      requestedAction: `Replace this project's report style with the style of “${picked.title}”?`,
      whyNeeded:
        'The project already has a style of its own. Saving this report’s style replaces it, and nothing is changed until you say so.',
      consequencesOfDelay: 'Nothing. The project keeps the style it has until you answer.',
      approvalOptions: [REPLACE_OPTION, KEEP_OPTION],
      declineOption: KEEP_OPTION,
      originatingAgent: ctx.staffSlug,
      workCanContinue: true,
      onAnswer: {
        option: REPLACE_OPTION,
        kind: 'style.adopt',
        payloads: [
          {
            slug,
            document_id: picked.documentId,
            title: picked.title,
            confirm: true,
            channel: ctx.channel,
            by,
          },
        ],
      },
    })
    return {
      outcome: 'asked_to_replace',
      blockerId,
      body:
        `This project already has a report style of its own. Saving the style of “${picked.title}” would replace it. ` +
        `Nothing has been changed yet. Say yes to replace it, or no to keep what the project has.${rest(ctx.request)}`,
    }
  }

  const saved = result.adopted === true || result.unchanged === true
  return {
    outcome: saved ? 'saved' : 'refused',
    body: `${saidAboutAdoption(picked.title, result)}${rest(ctx.request)}`,
  }
}
