/**
 * One answer from several specialists who worked at the same time (#262).
 *
 * `app.fan_out` splits a question into real child jobs. This is the job that
 * waits for them and writes the answer, and almost all of it is about the two
 * ways that answer can be dishonest.
 *
 * ## It cannot claim a branch that did not run
 *
 *   > *"Do not let the final answer claim a branch participated unless
 *   > canonical state proves that branch ran."*
 *
 * The prompt is built from `app.branch_outputs`, which joins each branch to an
 * output that EXISTS. A branch with no output is not in the list, so there is
 * nothing for the model to summarise — and the branches that failed are named
 * separately, in words, because a synthesis that quietly drops one reads
 * exactly like one that never had it.
 *
 * `namedWithoutEvidence` is the check behind that: an answer naming a
 * specialist whose branch produced nothing is refused before it is written.
 * #233 exists because the office used to narrate collaboration it had not
 * done, and a fan-in is the easiest place in the building to do it again.
 *
 * ## It waits without burning attempts
 *
 * Waiting is a PAUSE, not a retry (#263). A synthesis that retried while three
 * specialists were still working would exhaust `max_attempts` in about four
 * minutes and fail a question nobody had answered yet. `dependency_wait` says
 * what it is waiting for, in words, on the job.
 *
 * ## Permissions never combine
 *
 * This handler reads text. It calls no tool, touches no connector and holds no
 * reach of its own, which is what makes "the parent does not get the union of
 * its children's permissions" true by construction rather than by a rule
 * somebody has to remember.
 */

import { howComposed } from '../agents/provenance.ts'
import type { SqlExecutor } from '../db/executor.ts'
import { pauseJob } from '../jobs/checkpoint.ts'
import type { Handler, HandlerOutput, Job } from '../jobs/worker.ts'
import type { ProviderRouter } from '../providers/router.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

export interface SynthesiseDeps {
  readonly db: SqlExecutor
  readonly router: ProviderRouter | null
}

interface BranchOutput {
  readonly agent: string
  readonly name: string
  readonly purpose: string
  readonly required: boolean
  readonly body: string
  readonly confidence: string
  readonly evidence: string
}

interface Readiness {
  readonly ready: boolean
  readonly total: number
  readonly done: number
  readonly failed: number
  readonly running: number
  readonly waiting_for: { agent: string; purpose: string; required: boolean }[]
  readonly lost: {
    agent: string
    name?: string
    purpose: string
    required: boolean
    state: string
  }[]
}

/**
 * Who the answer named that has nothing behind them.
 *
 * Exported and tested without a model, because it is the whole of the
 * anti-fabrication property and a regex over names is the sort of thing that
 * looks right and matches nothing. Matched on the agent's DISPLAY name and on
 * their slug's words, because a model writes "Emma found" and never
 * "research-director found".
 */
export function namedWithoutEvidence(
  answer: string,
  present: readonly { name: string; agent: string }[],
  absent: readonly { agent: string; name?: string | undefined }[],
): readonly string[] {
  const said = answer.toLowerCase()
  const has = (needle: string): boolean => {
    const word = needle.toLowerCase().trim()
    if (word === '') return false
    return new RegExp(`(^|[^a-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`).test(
      said,
    )
  }
  const allowed = new Set(present.flatMap((p) => [p.name.toLowerCase(), p.agent.toLowerCase()]))
  const named: string[] = []
  for (const missing of absent) {
    if (allowed.has((missing.name ?? '').toLowerCase())) continue
    if (allowed.has(missing.agent.toLowerCase())) continue
    /*
      The slug as well as the name, and the slug spelled both ways.

      The first version checked only `name`, and the caller passes the lost
      branches with no name on them — so the gate examined an empty string for
      every absent colleague and could never fire. A unit test found it in one
      run, which is the whole argument for testing a guard against the shape
      its caller actually supplies rather than the shape it would like.
    */
    const first = (missing.name ?? '').split(/\s+/)[0] ?? ''
    const ways = [
      missing.name ?? '',
      first.length > 2 ? first : '',
      missing.agent,
      missing.agent.replace(/-/g, ' '),
    ].filter((w) => w !== '')
    if (ways.some((w) => has(w))) named.push(missing.name ?? missing.agent)
  }
  return named
}

const BRIEF =
  'Several colleagues looked at different parts of one question at the same ' +
  'time. Write the answer.\n\n' +
  'Use ONLY what they wrote below. Say who found what, by name. Where two of ' +
  'them disagree, say so and say what the disagreement is about rather than ' +
  'picking one silently. Where a part of the question has no answer below, ' +
  'say that part is unanswered and name it.\n\n' +
  'Do NOT mention a colleague who is not quoted below, even to say they were ' +
  'asked — anyone missing is listed separately and you will be told what to ' +
  'say about them. Two or three short paragraphs, no headings, no bullet list ' +
  'unless the content is genuinely a list.'

export function synthesiseHandler(deps: SynthesiseDeps): Handler {
  const { db, router } = deps
  return {
    kind: 'office.synthesise',
    handle: async (job: Job): Promise<HandlerOutput> => {
      const base = {
        announce: true,
        confidence: 'medium' as const,
        contradictions: null,
        evidence: 'inferred' as const,
        model: null,
        path: 'inference' as const,
        sources: [] as readonly string[],
      }
      const say = (body: string): HandlerOutput => ({ ...base, body }) satisfies HandlerOutput

      // raw-sql[2]: keyed by the claimed job; it reads the payload of the job the worker holds.
      const payload = (
        (
          await db.execute(
            `select pinned_config from public.jobs where job_id = ${lit(job.jobId)}::uuid`,
          )
        ).rows[0] as { pinned_config?: Record<string, unknown> } | undefined
      )?.pinned_config
      const group = String(payload?.group ?? '')
      const objective = String(payload?.objective ?? '').trim()
      if (group === '') {
        return say('I was asked to draw several answers together and not told which ones.')
      }

      const readRow = async <T>(sql: string, key: string): Promise<T> => {
        const raw = ((await db.execute(sql)).rows[0] as Record<string, unknown> | undefined)?.[key]
        return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T
      }
      const ready = await readRow<Readiness>(
        `select app.fan_in_ready(app.job_office(${lit(job.jobId)}::uuid), ${lit(group)}::uuid) as r`,
        'r',
      )

      if (!ready.ready) {
        /*
          Paused, not retried, and the pause says whose branch it is waiting
          for. A person looking at the job sees "waiting for Emma on the
          competitor research" rather than "attempt 3 of 5".
        */
        const who = ready.waiting_for
          .map((w) => `${w.agent}${w.required ? ' (needed)' : ''}`)
          .join(', ')
        await pauseJob(
          db,
          job.jobId,
          {
            detail: `${String(ready.done)} of ${String(ready.total)} branches are in.`,
            reason: 'dependency_wait',
            resumable: true,
            resumeWhen: `Waiting for ${who === '' ? 'the remaining branches' : who}.`,
            until: new Date(Date.now() + 60_000),
          },
          job,
        )
        return {
          ...base,
          announce: false,
          body: `Waiting for ${who === '' ? 'the rest of the team' : who} before I answer.`,
          evidence: 'verified',
          path: await howComposed(deps.db, job.jobId),
        }
      }

      const outputs = await readRow<BranchOutput[]>(
        `select app.branch_outputs(app.job_office(${lit(job.jobId)}::uuid), ${lit(group)}::uuid) as r`,
        'r',
      )
      if (outputs.length === 0) {
        /*
          Everybody was asked and nobody answered. Said plainly rather than
          answered from general knowledge: an invented synthesis of four
          branches that produced nothing is the worst output this handler could
          make, because it looks like the most work.
        */
        return say(
          `Nobody got anywhere with "${objective}". ${String(ready.failed)} of ` +
            `${String(ready.total)} branches failed and none produced an answer, so there is ` +
            'nothing for me to draw together. Nothing here is my own guess.',
        )
      }
      /*
        ONE BRANCH IS RELAYED, NOT SYNTHESISED (#312, 0562).

        `instruction.ts` registered a fan-in only at TWO or more specialists,
        on the reasoning that a fan-in over one branch is just that branch.
        Canonical traffic says that is the only shape that occurs:

            convened specialists   real turns
            0                      5138
            1                         2
            2 or more                 0

        So the gate stood one above the only case there was, and a single
        specialist's answer had no owner — it finished after the Chief had
        answered, `only_chief_speaks` kept it off his phone, and nothing
        delivered it.

        The comment was right about the work, though: with one branch there is
        nothing to draw together. Relaying it verbatim and attributed spends
        no model, cannot paraphrase a finding into something the specialist
        did not say, and cannot credit anybody who was not there — so the
        invention gate below has nothing to catch, because nothing was
        invented.
      */
      if (outputs.length === 1) {
        const only = outputs[0]
        if (only === undefined) return say('I was asked to relay an answer that is not there.')
        return {
          ...base,
          body: `${only.name} looked at this and came back with:\n\n${only.body.trim()}`,
          /*
            ASKED, NOT ASSERTED. `enforce_deterministic_claim` refuses
            `deterministic_retrieval` on any correlation that spent a model
            call — and the branch spent several on THIS one, because a child
            inherits its parent's correlation. Claiming it here would have
            failed the job at the insert, which is the shape CLAUDE.md records
            costing `office.notion_sync` twelve failures in a day.

            The branch's own confidence and evidence are plain strings off a
            jsonb row, so they are not claimed either: `base` keeps the
            conservative pair rather than asserting labels nothing validated.
          */
          path: await howComposed(deps.db, job.jobId),
        }
      }

      if (router === null) {
        return say(
          `${String(outputs.length)} colleagues answered and I cannot draw it together — the ` +
            'office has no model to think with. Their answers are on the job, unsummarised.',
        )
      }

      const lost = ready.lost
      const completion = await router.complete({
        correlationId: job.correlationId,
        jobId: job.jobId,
        maxTokens: 1_800,
        messages: [
          { content: BRIEF, role: 'system' },
          {
            content:
              `The question: ${objective}\n\n${outputs
                .map(
                  (o) =>
                    `## ${o.name} — ${o.purpose}\n(confidence ${o.confidence}, evidence ${o.evidence})\n\n${o.body}`,
                )
                .join('\n\n')}` +
              (lost.length === 0
                ? ''
                : `\n\n## Not answered\n${lost
                    .map((l) => `- ${l.purpose} (${l.state})`)
                    .join('\n')}\nSay that these parts are unanswered. Do not name who was ` +
                  'going to do them.'),
            role: 'user',
          },
        ],
      })

      /*
        The gate. An answer naming somebody with nothing behind them is refused
        rather than sent, because that sentence is indistinguishable from the
        real thing and it is the exact failure #233 was written for.
      */
      const invented = namedWithoutEvidence(
        completion.content,
        outputs.map((o) => ({ agent: o.agent, name: o.name })),
        lost.map((l) => ({ agent: l.agent, name: l.name })),
      )
      if (invented.length > 0) {
        return {
          ...base,
          body:
            `I drew the answer together and it credited ${invented.join(', ')} for work that ` +
            'did not happen, so I have not sent it. ' +
            `${String(outputs.length)} of ${String(ready.total)} branches answered; ask again ` +
            'and I will keep to those.',
          model: completion.model,
        }
      }

      return {
        ...base,
        body: completion.content.trim(),
        evidence: 'verified',
        model: completion.model,
        /*
          Every branch that really contributed, by job. This is what makes the
          collaboration checkable afterwards without reading the prose.
        */
        sources: outputs.map((o) => `branch:${o.agent} ${o.purpose}`),
      }
    },
  }
}
