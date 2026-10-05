/**
 * What the Google duties say when Google does not work, and when it works again (#413).
 *
 * Composed in CODE, not by a model: a notice about a failing integration is exactly the moment a model is least
 * trustworthy to word things, and a reworded notice defeats every dedupe (CLAUDE.md: `office.notion_sync` sent 137
 * messages in 128 wordings of one fact).
 *
 * The rules the words follow, which are Grant's:
 *   - lead with what happened to HIM, not with an error code. `invalid_grant` never appears; it stays in the incident's
 *     evidence for whoever investigates;
 *   - say what is affected, what still works, and what to do, in that order, in short paragraphs;
 *   - never say "press Connect Google" unless there is something to press. The caller asks `teamHqUrl` first and passes
 *     whether a link exists, and the sentence changes with it. The control is named by its label ("Reconnect Google"),
 *     which is true of a Telegram button and of a Slack link alike.
 */
import type { SqlExecutor } from '../db/executor.ts'
import type { GoogleProblem } from '../google/auth.ts'
import type { HandlerOutput } from '../jobs/worker.ts'
import { teamHqUrl } from './link.ts'
import { type IncidentReason, resolveProblems, seeProblem } from './report.ts'

export type GoogleDuty = 'mail' | 'calendar'

/** The problems that are about the connection as a whole: when any Google duty works, they are over. */
export const ACCOUNT_PROBLEMS = ['not_configured', 'not_connected', 'revoked', 'refused'] as const

/** The problem's identity. Scope and API trouble belong to one duty, because the other may be perfectly well. */
export const problemKey = (duty: GoogleDuty, problem: GoogleProblem): string =>
  problem === 'missing_scope' || problem === 'api_error' ? `${duty}_${problem}` : problem

/** What a successful run of this duty proves is over. */
export const closedBy = (duty: GoogleDuty): readonly string[] => [
  ...ACCOUNT_PROBLEMS,
  `${duty}_missing_scope`,
  `${duty}_api_error`,
]

const OF: Readonly<Record<GoogleDuty, string>> = { mail: 'your email', calendar: 'your calendar' }

export interface Words {
  readonly heading: string
  readonly body: string
  /** Whether there is something for the person to DO. A notice with nothing to do gets no button. */
  readonly actionable: boolean
}

const WHAT_STILL_WORKS =
  '*What still works*\n• Everything already saved: your projects, tasks, documents, and the mail and calendar I had already read.'

const reconnectStep = (hasButton: boolean): string =>
  hasButton
    ? 'Tap Reconnect Google below and connect Google again. It takes about a minute.'
    : 'Open Team HQ, go to Settings, then Connections, and choose Connect Google.'

const again = (reason: IncidentReason): string =>
  reason === 'reminder' ? "\n\nI'll remind you again tomorrow if it is still not fixed." : ''

/** The words for a problem. Pure, so every wording is a test. */
export function googleWords(
  problem: GoogleProblem,
  reason: Exclude<IncidentReason, 'quiet'>,
  duty: GoogleDuty,
  hasButton: boolean,
  detail?: string,
): Words {
  const still = reason === 'reminder'
  switch (problem) {
    case 'revoked':
      return {
        heading: still ? 'Google still needs to be reconnected' : 'Google needs to be reconnected',
        body:
          "Google has stopped accepting the connection I use to read your email and calendar, so I can't check either right now.\n\n" +
          "*What this affects*\n• New email and calendar changes won't show up in Team HQ until it is fixed.\n\n" +
          `${WHAT_STILL_WORKS}\n\n*What to do*\n${reconnectStep(hasButton)}${again(reason)}`,
        actionable: true,
      }
    case 'not_connected':
      return {
        heading: still ? "Google still isn't connected" : "Google isn't connected yet",
        body:
          'Email and calendar are switched on, but no Google account is connected, so there is nothing for me to read yet.\n\n' +
          `*What to do*\n${reconnectStep(hasButton)}${again(reason)}`,
        actionable: true,
      }
    case 'not_configured':
      return {
        heading: still ? "Google still isn't set up" : "Google isn't set up yet",
        body:
          'Email and calendar are switched on, but the Google connection has not been set up, so I cannot read them.\n\n' +
          `*What to do*\n${
            hasButton
              ? 'Tap Reconnect Google below to open the connection page and follow the steps there.'
              : 'Open Team HQ, go to Settings, then Connections, and follow the steps for Google.'
          }${again(reason)}`,
        actionable: true,
      }
    case 'refused':
      return {
        heading: still ? "Google still isn't letting me in" : "Google isn't letting me in",
        body:
          `Google turned down the connection when I tried to read ${OF[duty]}. This can be temporary.\n\n` +
          `*What to do*\nIf it does not clear by itself, connect Google again. ${
            hasButton
              ? 'Reconnect Google below takes you there.'
              : 'It is under Settings, then Connections.'
          }${again(reason)}`,
        actionable: true,
      }
    case 'missing_scope':
      return {
        heading: 'Google needs one more permission',
        body: `Google is connected, but not everything I need was allowed, so I cannot read ${OF[duty]}${
          detail === undefined || detail === '' ? '' : ` (${detail})`
        }.\n\n*What to do*\nConnect Google again and leave every box ticked. ${
          hasButton
            ? 'Reconnect Google below takes you there.'
            : 'It is under Settings, then Connections.'
        }${again(reason)}`,
        actionable: true,
      }
    default:
      return {
        heading: 'Google returned an error',
        body:
          `Google would not answer when I tried to read ${OF[duty]}. This is usually temporary and I will keep trying.\n\n` +
          `${WHAT_STILL_WORKS}\n\n*What to do*\nNothing yet. I will tell you if it does not clear.${again(reason)}`,
        actionable: false,
      }
  }
}

/** What is said once Google works again, after the person had been told it did not. */
export const googleRecoveredWords = (): Words => ({
  heading: 'Google is working again',
  body: 'I can read your email and calendar again, and I will catch up on anything that arrived in the meantime.\n\nNothing for you to do.',
  actionable: false,
})

const SOURCE: Readonly<Record<GoogleDuty, string>> = {
  mail: 'google:gmail',
  calendar: 'google:calendar',
}

const base = (duty: GoogleDuty) =>
  ({
    confidence: 'high',
    evidence: 'verified',
    sources: [SOURCE[duty]],
    contradictions: null,
    path: 'deterministic_retrieval',
    model: null,
  }) as const

/**
 * The output of a Google duty that could not do its work.
 *
 * `announce` is the incident layer's decision: true the first time and when a reminder is due, false while the person
 * has already been told and the problem is still open. The duty still fails or succeeds on its own terms and the record
 * of the run is still written: only whether a HUMAN is interrupted changes.
 */
export async function googleProblemOutput(
  db: SqlExecutor,
  input: {
    readonly office: string
    readonly duty: GoogleDuty
    readonly problem: GoogleProblem
    /** The raw note, kept as evidence for whoever investigates and never shown to the person. */
    readonly note: string
  },
): Promise<HandlerOutput> {
  const key = problemKey(input.duty, input.problem)
  const verdict = await seeProblem(db, input.office, 'google', key, {
    duty: input.duty,
    problem: input.problem,
    note: input.note.slice(0, 300),
  })

  const url = await teamHqUrl(db, '/?settings=connections')
  const words = googleWords(
    input.problem,
    verdict.reason === 'reminder' ? 'reminder' : 'first',
    input.duty,
    url !== null && googleWordsNeedsButton(input.problem),
    input.problem === 'missing_scope' ? scopeDetail(input.note) : undefined,
  )
  const button =
    url !== null && words.actionable
      ? { link: { label: 'Reconnect Google', url } }
      : ({} as Record<string, never>)

  return {
    body: words.body,
    announce: verdict.notify,
    // The same topic for every Google duty and every wording: `say_once` then treats mail and calendar as one subject.
    topic: `incident:google:${key}`,
    notice: { heading: words.heading, ...button },
    ...base(input.duty),
  }
}

const googleWordsNeedsButton = (problem: GoogleProblem): boolean => problem !== 'api_error'

/** "granted: a b c" out of the scope note, so the person is told which permission, never the whole URL list. */
const scopeDetail = (note: string): string | undefined => {
  const needs = /no (Gmail read|calendar) scope/.exec(note)?.[1]
  return needs === undefined ? undefined : `${needs} access`
}

/**
 * A successful run: close what it proves is over, and say so once if the person had been told.
 * Returns null when there is nothing to say, which is almost always.
 */
export async function googleRecoveryOutput(
  db: SqlExecutor,
  input: { readonly office: string; readonly duty: GoogleDuty },
): Promise<HandlerOutput | null> {
  const closed = await resolveProblems(db, input.office, 'google', closedBy(input.duty))
  if (closed.closed === 0 || !closed.wasTold) return null
  const words = googleRecoveredWords()
  return {
    body: words.body,
    announce: true,
    topic: 'incident:google:recovered',
    notice: { heading: words.heading },
    ...base(input.duty),
  }
}
