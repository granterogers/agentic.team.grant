/**
 * Turning a skill Hermes wrote into a draft the office can be asked about, and an approved skill into a file Hermes can read
 * (Hermes, M8b; docs/hermes/LEARNING-AND-SKILL-TRANSFER.md sections 4 and 6).
 *
 * Pure: text in, text out. Two jobs and nothing else:
 *
 *   convertSkill  Remove what the team cannot do or must not carry (code, scripts, templates, assets), map the office's own tools by NAME
 *                 through a closed table, say what was left out, and shape the five fields the gateway accepts. It REFUSES NOTHING on
 *                 safety grounds: whether a text is acceptable (authority, code, addresses, credentials, size, tools) is decided in ONE
 *                 place, `app.engine_skill_offer_problem` in the database, which runs again when a person presses Accept. A second copy
 *                 of those patterns here would be a second place for them to disagree, and a conversion that is more lenient than the
 *                 database changes nothing while one that is stricter hides a proposal the person would have wanted to see refused.
 *   skillFile     The text of a read-only reference file for Hermes, built only from fields that are already approved and live.
 *
 * Everything in a Hermes-authored draft is untrusted text. Nothing here executes it, evaluates it or follows an instruction in it.
 */
import { ENGINE_READ_TOOLS, OFFICE_TOOL_PREFIX } from './timing.ts'

/** What the bridge reads from a skill directory Hermes wrote. Untrusted text in every field. */
export interface HermesSkillDraft {
  readonly name: string
  readonly description: string
  readonly body: string
  /** Relative paths under the skill's folder, names only (never contents), for what did not transfer. */
  readonly files: readonly string[]
}

/** The five fields the gateway accepts: nothing about where a skill applies, which run it came from or what it is. */
export interface SkillOffer {
  readonly name: string
  readonly when: string
  readonly procedure: string
  readonly tools: readonly string[]
  readonly dropped: readonly string[]
}

export type Conversion =
  | { readonly ok: true; readonly offer: SkillOffer }
  | { readonly ok: false; readonly reason: string }

/** The office tool an MCP read tool stands for. Every read tool reads the office's own records; none is a writing tool. */
export const OFFICE_TOOL_FOR: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(ENGINE_READ_TOOLS.map((t) => [t, 'db.read'])),
)

/** Hermes built-ins the team does not have. A mention is reported, never copied as a step. */
const HERMES_ONLY = [
  'terminal',
  'execute_code',
  'code_execution',
  'browser',
  'web_search',
  'web_extract',
  'delegate_task',
  'cronjob',
  'send_message',
  'read_file',
  'write_file',
  'patch',
  'skill_manage',
  'image_generate',
  'text_to_speech',
] as const

const MAX_PROCEDURE = 4000
const MAX_NAME = 80
const MAX_WHEN = 400
const SHORTENED = '\n(shortened)'
const NOT_TRANSFERRED_DIRS = /^(scripts|templates|assets)\//

/**
 * `SKILL.md`: a front matter block between two lines of three dashes (name, description) and the markdown after it. Anything it cannot
 * read as that is null, never a guess. Values are single lines; quotes around a value are removed; nothing is evaluated.
 */
export const parseSkillMd = (
  text: string,
): { readonly name: string; readonly description: string; readonly body: string } | null => {
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(text.replace(/^﻿/, ''))
  if (m === null) return null
  const fields = new Map<string, string>()
  for (const line of (m[1] ?? '').split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*)[ \t]*:[ \t]*(.*)$/.exec(line)
    if (kv === null) continue
    const value = (kv[2] ?? '').trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
    if (!fields.has(kv[1] as string)) fields.set(kv[1] as string, value)
  }
  const name = fields.get('name') ?? ''
  const description = fields.get('description') ?? ''
  if (name === '' || description === '') return null
  return { name, description, body: m[2] ?? '' }
}

const squash = (s: string): string => s.replace(/[ \t]+/g, ' ').trim()

/** Cut at a paragraph or line boundary, never inside a word, and say so. */
const shorten = (text: string, max: number): string => {
  if (text.length <= max) return text
  const room = max - SHORTENED.length
  const head = text.slice(0, room)
  const cut = Math.max(head.lastIndexOf('\n\n'), head.lastIndexOf('\n'), head.lastIndexOf('. ') + 1)
  return `${(cut > room * 0.4 ? head.slice(0, cut) : head.replace(/\s+\S*$/, '')).trimEnd()}${SHORTENED}`
}

const plural = (n: number, one: string, many: string): string =>
  `${String(n)} ${n === 1 ? one : many}`

export const convertSkill = (draft: HermesSkillDraft): Conversion => {
  const dropped: string[] = []

  // Code does not transfer: the team cannot run it, and a fenced block is how a command travels inside prose.
  let blocks = 0
  let procedure = draft.body.replace(/```[\s\S]*?(?:```|$)/g, () => {
    blocks += 1
    return ''
  })
  if (blocks > 0)
    dropped.push(
      `${plural(blocks, 'code block was', 'code blocks were')} not transferred: the team cannot run code.`,
    )

  const heavy = draft.files.filter((f) => NOT_TRANSFERRED_DIRS.test(f))
  if (heavy.length > 0)
    dropped.push(
      `${plural(heavy.length, 'file in scripts, templates or assets was', 'files in scripts, templates or assets were')} not transferred.`,
    )

  // The office's own tools by NAME, through a closed table. A name the table does not know grants nothing and maps to nothing.
  const tools = new Set<string>()
  let unmapped = 0
  // The prefix is a fixed string of letters and underscores (timing.ts), so it needs no escaping here.
  for (const m of procedure.matchAll(
    new RegExp(`${OFFICE_TOOL_PREFIX}([a-z][a-z0-9_]{1,39})`, 'g'),
  )) {
    const mapped = OFFICE_TOOL_FOR[m[1] as string]
    if (mapped === undefined) unmapped += 1
    else tools.add(mapped)
  }
  if (unmapped > 0)
    dropped.push(`${plural(unmapped, 'tool name was', 'tool names were')} not one the team has.`)
  procedure = procedure.split(OFFICE_TOOL_PREFIX).join('')

  const lower = procedure.toLowerCase()
  const builtIns = HERMES_ONLY.filter((t) =>
    new RegExp(`(^|[^a-z0-9_])${t}([^a-z0-9_]|$)`).test(lower),
  )
  if (builtIns.length > 0) {
    dropped.push(`Hermes used ${builtIns.join(', ')}, which the team does not have.`)
    procedure = `Hermes used ${builtIns.join(', ')}, which the team does not have.\n${procedure}`
  }

  procedure = shorten(
    procedure
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.replace(/[ \t]+$/g, ''))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim(),
    MAX_PROCEDURE,
  )
  if (procedure.length < 40)
    return {
      ok: false,
      reason:
        'Nothing the team could follow was left once code and unavailable tools were removed.',
    }

  const name = squash(draft.name).slice(0, MAX_NAME)
  const when = squash(draft.description).slice(0, MAX_WHEN)
  if (name.length < 3) return { ok: false, reason: 'The skill has no usable name.' }
  if (when.length < 12) return { ok: false, reason: 'The skill does not say when to use it.' }
  return {
    ok: true,
    offer: { name, when, procedure, tools: [...tools].slice(0, 5), dropped: dropped.slice(0, 10) },
  }
}

/** The slug a skill is filed under for Hermes: fixed by the office, never taken from a name a model chose. */
export const SLUG = /^skill-[0-9a-f]{12}$/

/**
 * The reference file for one approved, live skill. The name and the description are single lines with nothing in them that could end
 * the front matter early; the procedure is the stored text verbatim.
 */
export const skillFile = (s: {
  readonly name: string
  readonly when_to_use: string
  readonly procedure: string
}): string => {
  const line = (v: string): string => squash(v.replace(/[\r\n]+/g, ' ')).replace(/---+/g, '-')
  return `---\nname: ${line(s.name)}\ndescription: ${line(s.when_to_use)}\n---\n\n${s.procedure}\n`
}
