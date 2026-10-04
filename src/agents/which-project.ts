/**
 * "Which project do you mean?", asked instead of guessed (#416, Telegram and Slack).
 *
 * Team HQ never needs this: the page states which project is loaded and that is the project. Telegram has no loaded
 * project. A message that names one resolves by name (`app.enqueue_inbound`, 0880), and a conversation that has already
 * been about one stays on it. What is left is a message that POINTS at a project it has not named, in a conversation with
 * nothing established: "what is outstanding on this project?". Answering from the general Conversation would be a guess
 * dressed as an answer, so the office asks, and the person's next message names it.
 *
 * Narrow on purpose. It fires only on a demonstrative reference to a project ("this project", "that project", "the
 * current project"), because those words have no meaning without one, and never on a request to START one ("create a
 * new project called ..."), which is not about an existing project at all.
 */
import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

const POINTS_AT = /\b(?:this|that|the\s+same|the\s+current|our\s+current|my\s+current)\s+project\b/i
// Starting, naming or listing projects is about projects in general, not about one the person has in mind.
const STARTS_ONE =
  /\b(?:new|create|creating|start|starting|set\s*up|make|making|begin|called|named|titled)\b[^.?!]{0,40}\bproject\b/i
const ABOUT_PROJECTS_AS_A_LIST =
  /\b(?:which|what)\s+projects?\b|\ball\s+(?:my|our|the)\s+projects\b/i

/** Does this message point at a project without naming one? Pure. */
export const pointsAtAProject = (words: string): boolean =>
  POINTS_AT.test(words) && !STARTS_ONE.test(words) && !ABOUT_PROJECTS_AS_A_LIST.test(words)

/** The channels that have no loaded project of their own. The dashboard states its project, so it never asks. */
export const UNSCOPED_CHANNELS: readonly string[] = ['telegram', 'slack']

/** The question, in the person's words. Pure. */
export const whichProjectQuestion = (names: readonly string[]): string => {
  const list =
    names.length <= 1
      ? names.map((n) => `“${n}”`).join('')
      : `${names
          .slice(0, -1)
          .map((n) => `“${n}”`)
          .join(', ')} or “${names.at(-1)}”`
  return (
    `Which project do you mean? ${names.length === 0 ? '' : `You have ${list}. `}` +
    'Tell me which and I will pick it up from there.'
  )
}

/**
 * The active project names to ask about, or null when there is nothing to ask: the channel has a project of its own,
 * the job already resolved to a real project, or there are fewer than two to choose between.
 */
export async function projectsToAskAbout(
  db: SqlExecutor,
  jobId: string,
  channel: string,
): Promise<string[] | null> {
  if (!UNSCOPED_CHANNELS.includes(channel)) return null
  const { rows } = await db.execute(`
    select p.name
      from public.jobs j
      join public.projects p on p.office_id = j.office_id
     where j.job_id = ${lit(jobId)}::uuid
       and j.project_id = app.unnamed_project(j.office_id)
       and p.status = 'active' and not p.is_fixture and p.slug <> 'unnamed'
     order by p.name
  `)
  const names = rows
    .map((r) => String((r as { name?: unknown }).name ?? ''))
    .filter((n) => n !== '')
  return names.length >= 2 ? names : null
}
