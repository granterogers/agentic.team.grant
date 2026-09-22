/**
 * Which Supabase project a command is about to talk to.
 *
 * ## The problem this exists for
 *
 * 252 files in this repository write
 *
 *     process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
 *
 * and that default is the project this repository was developed against. For
 * Grant it is correct and load-bearing: a Claude Code session starts with no
 * environment at all, and without the default not one command in the
 * repository would run. Removing it would break every session on the day it
 * shipped, in the name of somebody who does not exist yet.
 *
 * For a second person it is the quiet failure §5 asks to hunt for. They set
 * their own access token, forget the project reference, and every command
 * points at a project that is not theirs. Their token is refused, so nothing
 * is damaged — but what they see is an authorisation error naming a project
 * they have never heard of, and there is no sentence anywhere saying why.
 *
 * ## So the default stays and stops being silent
 *
 * `resolveProjectRef` returns the environment variable when it is set, and
 * otherwise returns the development default AFTER saying, once, that it has
 * done so and what to set. Grant's flow is unchanged to the character; a new
 * person is told, in the first line of output, the one thing they need to know.
 *
 * Neither half of that is a guess: the fallback is silent today, and 252 call
 * sites cannot each be asked to remember to explain themselves, which is the
 * same argument `ManagementApiExecutor` makes about refusing an empty ref in
 * one place rather than in 82.
 */
import { GRANT_PRODUCTION_PROJECT_REF } from './forbidden.ts'

/**
 * The project this repository was developed against.
 *
 * Not a credential — it is the public subdomain of an API URL — and named here
 * once so that a reader of any call site can find out what the default IS,
 * which a bare literal in 252 files does not tell them.
 */
export const DEVELOPMENT_PROJECT_REF = GRANT_PRODUCTION_PROJECT_REF

let alreadySaid = false

export interface ResolveOptions {
  /** Where to say it. Overridden in tests; nothing else passes it. */
  readonly warn?: (line: string) => void
  /** What the caller is about to do, so the sentence can name it. */
  readonly forWhat?: string
}

export function resolveProjectRef(options: ResolveOptions = {}): string {
  const fromEnv = process.env.SUPABASE_PROJECT_REF
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv

  const warn = options.warn ?? ((line: string): void => console.error(line))
  if (!alreadySaid) {
    alreadySaid = true
    warn(
      `\nSUPABASE_PROJECT_REF is not set, so ${options.forWhat ?? 'this command'} is using the ` +
        `project this repository was developed against (${DEVELOPMENT_PROJECT_REF}).\n` +
        'If you are running your own office, that is not the one you want:\n\n' +
        '    export SUPABASE_PROJECT_REF=<your project reference>\n\n' +
        'Run npm run fresh:doctor if you are not sure what yours is.\n',
    )
  }
  return DEVELOPMENT_PROJECT_REF
}

/** Test seam: forget that the warning has been given. */
export function resetProjectRefWarning(): void {
  alreadySaid = false
}
