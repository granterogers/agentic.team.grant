/**
 * Finding the tasks inside something the office has read (#130).
 *
 * The headline unlock of #130, and the reason it stayed open after 0272
 * declared the contract: *"nothing in the office extracts tasks today. This is
 * a new capability rather than a contract, and it is what makes 'a list of
 * extracted tasks can become real tasks' true."*
 *
 * `tasks_extracted` has been a declared, validated, trigger-enforced shape
 * since 0272 and had never held a row. A contract nothing produces is the same
 * family as a column nothing writes and a control nothing presses, and this
 * repository has shipped all three.
 *
 * ## Structure BESIDE the prose, never instead of it
 *
 * #130 is explicit: *"An output that is only structured is an output nobody
 * wants to receive."* So `body` is the sentence Grant reads on Telegram and
 * `facts` is the same answer in a shape `hq_task_add` and #28's import can use
 * without parsing English. Both, from one pass.
 *
 * ## The tasks are really created
 *
 * Not proposed. The office already writes one task from one instruction
 * without asking, and a list of twelve that Grant then has to approve
 * individually is a worse product than a list of twelve with one way to undo
 * them — which is what `app.undo_offer` is for. Creating nothing and
 * describing what it WOULD create is the failure #246 caught: narration
 * instead of action.
 *
 * ## What it will not do
 *
 * It will not invent a source. If the document he named cannot be found, it
 * says so and stops rather than extracting from the whole project and
 * reporting success — an answer about the wrong material is worse than no
 * answer, because he cannot tell.
 */

import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'
import { scrub } from '../text/scrub.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** One thing to do, as the model proposes it and as the shape stores it. */
export interface Extracted {
  readonly title: string
  readonly detail: string | null
  readonly due_on: string | null
}

export interface ExtractTasksDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter | null
}

/** More than this from one document is a model listing sentences, not tasks. */
const MOST = 12
/** Enough of a document to find its actions in, and a bounded prompt. */
const READ = 14_000

/**
 * What the model proposed, kept only where it is usable.
 *
 * Validated hard for the same reason `curriculum()` is: this runs on a free
 * tier, a malformed answer must not become an empty list reported as success,
 * and — unlike a curriculum — every surviving row becomes a real write into a
 * list Grant looks at.
 *
 * Exported because it is the whole of the risk and deserves testing without a
 * database or a model.
 */
export function readTasks(text: string): Extracted[] {
  const cleaned = scrub(text)
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) return []
  let parsed: { tasks?: unknown }
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1)) as { tasks?: unknown }
  } catch {
    return []
  }
  const seen = new Set<string>()
  return (Array.isArray(parsed.tasks) ? parsed.tasks : [])
    .map((raw): Extracted | null => {
      const t = raw as Record<string, unknown>
      const title = String(t.title ?? '')
        .trim()
        .replace(/\s+/g, ' ')
      if (title === '' || title.length > 160) return null
      /*
        A date the model invented is worse than no date: it lands in Grant's
        diary and nothing about the answer says it was guessed. Only an
        unambiguous ISO day survives.

        Checked by ROUND TRIP, not by `Date.parse`. The first draft used
        `!Number.isNaN(Date.parse(raw))` and a unit test caught it within the
        minute: `Date.parse('2026-02-31')` is a perfectly good number, because
        JavaScript rolls the extra days over into March. A day that comes back
        as a different day was never that day.
      */
      const raw_due = String(t.due_on ?? '').trim()
      const asDay = /^\d{4}-\d{2}-\d{2}$/.test(raw_due) ? new Date(`${raw_due}T00:00:00Z`) : null
      const due =
        asDay !== null &&
        !Number.isNaN(asDay.getTime()) &&
        asDay.toISOString().slice(0, 10) === raw_due
          ? raw_due
          : null
      const detail = String(t.detail ?? '')
        .trim()
        .slice(0, 600)
      return { title, detail: detail === '' ? null : detail, due_on: due }
    })
    .filter((t): t is Extracted => t !== null)
    .filter((t) => {
      // The same action said twice is one task. A model asked for a list from
      // a document with a summary at the end returns the summary's copy too.
      const key = t.title.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MOST)
}

export function extractTasksHandler(deps: ExtractTasksDeps): Handler {
  const { db, router } = deps
  return {
    kind: 'office.extract_tasks',
    handle: async (job: Job): Promise<HandlerOutput> => {
      /*
        NO BRANCH OF A CHILD JOB MAY CLAIM DETERMINISM, not merely the ones
        below its own model call.

        A CHILD SHARES ITS PARENT'S CORRELATION. `office.extract_tasks` is
        enqueued by `office.instruction`, which by then has spent a semantic
        read and an answer, so `enforce_deterministic_claim` — which counts
        inferences against the CORRELATION — refuses the claim from the child's
        very first line. Fixing only the two returns below `router.complete`
        left the early ones claiming it, and the run that found this failed on
        exactly one of those: the named source did not match a document, the
        handler said so through `say`, and the honest sentence was refused.

        `base` was spread into all five returns with
        `path: 'deterministic_retrieval'`, and two of those sit AFTER
        `router.complete`. `enforce_deterministic_claim` refuses the claim on
        any correlation that spent an inference and is right to, so the output
        INSERT was refused, the job FAILED, and Grant got nothing for a
        delegation he had asked for.

        It went unseen because nothing reached this handler from an ordinary
        sentence until #282 taught `extract.ts` the "read a source and make
        tasks" shape — and because `verify:extract` asserts the TASK ROWS,
        which really were created, rather than the output the job dies on.

        This is `provenance.ts`'s own worked example happening a third time:
        one `base` object, one claim, five returns, and only the branches that
        spend a model are wrong. So the claim is ASKED rather than asserted,
        which is what `howComposed` is for.
      */
      const base = {
        confidence: 'high' as const,
        evidence: 'verified' as const,
        sources: [`job:${job.jobId}`],
        contradictions: null,
        model: null,
      }
      /*
        Asked AFTER the model call in each branch that makes one, never in the
        object literal beside the body: CLAUDE.md records two handlers that
        asked one step too early because an object literal evaluates in source
        order, and failed every two hours for six hours.
      */
      const spent = async (): Promise<'deterministic_retrieval' | 'inference'> =>
        await howComposed(db, job.jobId)
      const say = async (body: string): Promise<HandlerOutput> =>
        ({ ...base, path: await spent(), body }) satisfies HandlerOutput

      if (job.projectId === null || job.projectId === undefined) {
        return await say('I do not know which project that is about. Say which one.')
      }
      const payload = (
        (
          await db.execute(
            `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown> } | undefined
      )?.pinned_config
      const namedRaw = String(payload?.from ?? '').trim()

      /*
        NAMING THE PROJECT MEANS THE WHOLE PROJECT, not a document called that.

        "Scan the entirety of the Legacy Coaching Project and create
        appropriate tasks" names a source, and the source is the project. The
        lookup below matches DOCUMENT TITLES, so the run that found this went
        hunting for a document called "Anchor proof uugvui8u", found none, and
        told Grant it could not find anything by that name — about a project
        with documents in it, which he had just asked it to read in full.

        `from: null` is the reading this handler already has for "what needs
        doing here", so the project name simply resolves to it. Matched with
        the same trigram the title lookup uses, because he will say "the Legacy
        Coaching project" for a project called "Legacy Coaching Course".
      */
      const named =
        namedRaw === '' ||
        (await db
          .execute(`
              select (extensions.similarity(lower(name), ${lit(namedRaw.toLowerCase())}) > 0.5
                      or lower(name) like ${lit(`%${namedRaw.toLowerCase()}%`)}
                      or ${lit(namedRaw.toLowerCase())} like '%' || lower(name) || '%') as whole
                from public.projects where project_id = ${lit(job.projectId)}::uuid`)
          .then((r) => (r.rows[0] as { whole?: boolean } | undefined)?.whole === true)
          .catch(() => false))
          ? ''
          : namedRaw

      /*
        The material. A named source is matched on its title and NOTHING ELSE
        is read — `extensions.similarity` because he will type "the pricing
        brief" for a document called "WS02 Pricing.pdf", and qualified because
        a function with an empty search_path cannot see the extensions schema.
      */
      const sources = (
        await db.execute(
          named === ''
            ? `select title, coalesce(content, '') as content
                 from public.documents
                where project_id = ${lit(job.projectId)}::uuid
                  and coalesce(content, '') <> ''
                order by content_chars desc limit 4`
            : `select title, coalesce(content, '') as content
                 from public.documents
                where project_id = ${lit(job.projectId)}::uuid
                  and coalesce(content, '') <> ''
                  and (title ilike ${lit(`%${named}%`)}
                       or extensions.similarity(lower(title), ${lit(named.toLowerCase())}) > 0.3)
                order by extensions.similarity(lower(title), ${lit(named.toLowerCase())}) desc
                limit 2`,
        )
      ).rows.map((r) => ({ title: String(r.title), content: String(r.content) }))

      if (sources.length === 0) {
        return await say(
          named === ''
            ? 'There is nothing read in on this project yet, so there is nothing to pull tasks out of.'
            : `I could not find anything here called “${named}”. If it is in a notebook or a ` +
                'Drive folder we have not read yet, say so and I will bring it in first.',
        )
      }
      if (router === null) {
        return await say(
          'I cannot read anything closely just now — the office has no model to think with.',
        )
      }

      const from = sources.map((s) => s.title).join(', ')
      const completion = await router.complete({
        messages: [
          {
            role: 'system',
            content:
              'You find the things that need DOING inside a document. Reply with JSON only — ' +
              'no preamble, no code fence, no commentary.\n\n' +
              'Shape: {"tasks":[{"title":"...","detail":"...","due_on":"YYYY-MM-DD"}]}\n\n' +
              'Each title is one concrete action starting with a verb, under 120 characters. ' +
              '`detail` is optional and is one sentence of context from the document. ' +
              '`due_on` ONLY where the document states a date — never estimate one, and omit ' +
              'the field entirely if it does not say. Between one and twelve tasks. If the ' +
              'document contains nothing to do, reply {"tasks":[]} rather than inventing any.',
          },
          {
            role: 'user',
            content: sources
              .map((s) => `## ${s.title}\n\n${s.content.slice(0, READ)}`)
              .join('\n\n'),
          },
        ],
        maxTokens: 2_000,
        jobId: job.jobId,
        correlationId: job.correlationId,
      })

      const found = readTasks(completion.content)
      if (found.length === 0) {
        /*
          An honest empty answer, and it carries the shape too. "Nothing to do
          in here" is a real finding and a consumer should not have to read a
          sentence to establish it — which is 0272's own argument for
          `nothing_happened`.
        */
        return {
          ...base,
          path: await spent(),
          body: `I read ${from} and could not find anything in it that needs doing.`,
          shape: 'tasks_extracted',
          facts: { tasks: [], from },
        } satisfies HandlerOutput
      }

      /*
        And they are really created. A row per task, each reported, and a
        failure named rather than silently dropped — `app.task_add` refuses a
        duplicate title in the same project, which is a legitimate answer and
        not an error.
      */
      const made: string[] = []
      const refused: string[] = []
      for (const task of found) {
        const row = (
          await db
            .execute(`
              select app.task_add(
                p_office  => app.job_office(${lit(job.jobId)}::uuid),
                p_project => ${lit(job.projectId)}::uuid,
                p_title   => ${lit(task.title)},
                p_detail  => ${task.detail === null ? 'null' : lit(task.detail)},
                p_due_on  => ${task.due_on === null ? 'null' : `${lit(task.due_on)}::date`},
                -- Named, not positional. The signature is eight arguments and
                -- p_job is the eighth; passing it seventh would have set
                -- p_added_by to a uuid and left the reversal with nothing to
                -- key on, which the undo would have reported as all of them.
                -- No backticks here: this comment is inside a template literal.
                p_job     => ${lit(job.jobId)}::uuid) as r`)
            .catch((error: unknown) => ({
              rows: [{ r: { error: String((error as Error).message).slice(0, 120) } }],
            }))
        ).rows[0] as { r?: { error?: string; id?: string } }
        /*
          `app.task_add` answers with `id`, not `task_id`. Read from the
          function rather than assumed: the first draft checked `task_id`,
          which is never present, so every task would have been created
          successfully and reported to Grant as refused.
        */
        if (row.r?.id === undefined) refused.push(`${task.title} (${row.r?.error ?? 'refused'})`)
        else made.push(task.title)
      }

      /*
        One way to undo the lot.

        Twelve tasks is a lot to have appear at once, and #118's strip is the
        answer the office already has for "that was not what I wanted". Offered
        rather than forced, and never allowed to fail the work that succeeded.
      */
      if (made.length > 0) {
        await db
          .execute(`
            select app.undo_offer(app.job_office(${lit(job.jobId)}::uuid), 'tasks_extracted',
              ${lit(`the ${String(made.length)} task(s) pulled out of ${from}`)},
              jsonb_build_object('action', 'tasks_from_job',
                'args', jsonb_build_object('p_job', ${lit(job.jobId)})),
              120)`)
          .catch(() => undefined)
      }

      const body =
        `I read ${from} and pulled out ${String(made.length)} ` +
        `${made.length === 1 ? 'thing' : 'things'} that need doing:\n\n` +
        made.map((t, i) => `${String(i + 1)}. ${t}`).join('\n') +
        (refused.length === 0
          ? ''
          : `\n\nTwo of these I could not add: ${refused.slice(0, 3).join('; ')}.`) +
        '\n\nThey are on the project now. Say so if any of them is wrong.'

      return {
        ...base,
        path: await spent(),
        body,
        shape: 'tasks_extracted',
        facts: { tasks: found, from },
        acted: made.length,
      } satisfies HandlerOutput
    },
  }
}
