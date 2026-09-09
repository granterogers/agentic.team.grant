/**
 * Reading a multi-step instruction, and saying it back before doing any of it.
 *
 * Grant, in a voice note attached to a YouTube link: *"I want you to push this
 * video into a new notebook project called AI Learning, then find me the
 * transcription and then report back to me here in Telegram all the
 * repositories that are mentioned and provide me the URLs so I can investigate
 * them immediately."*
 *
 * And, in the same breath: *"probably good idea that he confirms he
 * understands and spits back what I want before going ahead."*
 *
 * Those two sentences are one feature. A single-step instruction can be acted
 * on and reported; a four-step one has three places to go wrong before anything
 * comes back, and by then the work is done wrongly. So a plan is written first,
 * shown, and held until he says go.
 *
 * ## Why the plan is assembled and not generated
 *
 * Every step below corresponds to a job kind that already exists. A model
 * asked to plan freely would produce steps nothing can execute — and the
 * failure would look like agreement: a confident plan, approved, followed by
 * silence. Assembling from a fixed vocabulary means the plan he approves is
 * exactly the plan that will run, which is the whole point of showing it.
 *
 * The cost is real and worth naming: an instruction whose shape is not in this
 * file gets a prose answer rather than a plan. That is recoverable by
 * rephrasing. A plan that cannot be executed is not.
 *
 * ## What it reads
 *
 * The verbs and nouns that `actions.ts` and `links.ts` already recognise, plus
 * two things they did not:
 *
 *   - **a project that does not exist yet.** "a new notebook project called AI
 *     Learning" is a project AND a notebook AND an attachment, and Grant
 *     should not have to make any of those by hand first.
 *   - **a question to put to the sources once they are in.** "report back all
 *     the repositories that are mentioned, with URLs" is not a request for an
 *     artifact; it is a question for the notebook to answer about its own
 *     sources, which `notebook.ask` does.
 */

import { KIND_LABEL, notebookRequest, type RequestedKind } from './actions.ts'
import { classifyLink, type FoundLink, linkRequest } from './links.ts'

/** One thing that will happen, in the order it will happen. */
export type Step =
  /**
   * A project by this name — existing if there is one, new only if there is
   * not, and the difference is decided against reality rather than here.
   *
   * The first version emitted `create_project` straight from the words "a new
   * project called X" and created one. Grant already had a notebook called "AI
   * learning"; the planner made "AI Learning" beside it, and then a second
   * called "AI Learning Two" during a test. Three notebooks, one intention.
   *
   * *"Please don't assume I wish to create a new project. This is a large task
   * and should always be confirmed. In my example I was telling it to work on
   * an existing project."*
   *
   * So the planner names the project and does not decide its fate. The handler
   * resolves it — our own projects first, then the notebooks in Grant's
   * account — and rewrites this into `use_project` or `create_project` before
   * the plan is ever shown. What he approves therefore says which one it is.
   */
  | { readonly kind: 'project'; readonly name: string }
  | { readonly kind: 'use_project'; readonly name: string; readonly notebookRef: string }
  /**
   * It matched more than one thing, or matched one thing loosely, and the
   * difference is Grant's to settle.
   *
   * The gap this closes: resolution used to be an exact match on a normalised
   * name, so "the wellness project" against a project actually called "Wellness
   * & Health" missed — and a miss meant `create_project`. Every near miss was
   * therefore a new project, which is precisely how `ai-learning-2` and three
   * notebooks called some version of "AI Learning" came to exist.
   *
   * Near misses now land here instead. This step never runs; it is a question,
   * and the plan holding it waits.
   */
  | {
      readonly kind: 'ambiguous_project'
      readonly name: string
      readonly candidates: readonly { readonly name: string; readonly slug: string }[]
    }
  | { readonly kind: 'create_project'; readonly name: string }
  | { readonly kind: 'add_source'; readonly link: FoundLink }
  | { readonly kind: 'attach'; readonly link: FoundLink }
  | { readonly kind: 'generate'; readonly artifact: RequestedKind }
  | { readonly kind: 'ask'; readonly question: string }

export interface Plan {
  readonly steps: readonly Step[]
  /** The project the plan is about, when the instruction named one. */
  readonly project: string | null
  /** The instruction as given, kept so the confirmation can quote it. */
  readonly instruction: string
}

/**
 * "a new project called X", in the phrasings people use.
 *
 * `new` is load-bearing. "add this to the coaching project" names an existing
 * one and `links.ts` resolves it; "a new project called AI Learning" is an
 * instruction to create something, and confusing the two either creates a
 * duplicate or files work into a project that does not exist.
 */
/**
 * Where a project's name stops.
 *
 * Punctuation, the end of the message, or a conjunction that starts the next
 * clause. Without the conjunctions the capture is greedy to the end of an
 * unpunctuated sentence: "the project called Research and summarise it" gave a
 * project named "Research and summarise it", which would then match nothing
 * and propose creating it.
 */
const NAME_ENDS = String.raw`["”']?\s*(?=[.,;!?]|$|\band\b|\bthen\b|\bwith\b|\bso\b)`
// Not `String.raw`: this fragment contains no escape sequence, and biome
// rejects a raw string that has nothing to keep raw. `NAME_ENDS` above does
// (\s, \b) and stays raw.
const NAME = `["“']?([A-Za-z0-9][A-Za-z0-9 &._-]{1,48}?)`

const NEW_PROJECT = new RegExp(
  String.raw`\bnew\b[^.]{0,40}?\b(?:notebook\s+)?project\s+(?:called|named|titled)\s+${NAME}${NAME_ENDS}`,
  'i',
)

/**
 * A project named without the word "new".
 *
 * "the notebook project called AI learning" — which is what Grant actually
 * says when he means one he already has, and which the pattern above does not
 * match. The first version therefore emitted no project step at all and the
 * plan silently used whichever project the message had been filed under.
 *
 * Both patterns now produce the same `project` step. Whether it exists is the
 * resolver's job either way, so the presence or absence of the word "new" stops
 * being load-bearing — which is the right outcome: it was never a reliable
 * signal about Grant's intent, only about his phrasing.
 */
const NAMED_PROJECT = new RegExp(
  String.raw`\b(?:notebook\s+)?project\s+(?:called|named|titled)\s+${NAME}${NAME_ENDS}`,
  'i',
)

/**
 * A request to report on what the sources say.
 *
 * Distinguished from an artifact request by what it asks FOR: a list, the
 * names of things, the URLs. "Make me an audio overview" wants a file; "tell me
 * every repository mentioned" wants an answer, and the notebook can answer
 * questions about its own sources without generating anything.
 */
const WANTS_AN_ANSWER =
  /\b(?:report back|tell me|list|find me|give me|what are|which|extract|pull out|summarise|summarize)\b/i

/** Phrases that mean "the thing I just sent you". */
const THE_TRANSCRIPT = /\b(?:transcription|transcript|what(?:'s| is) in it|the contents?)\b/i

/**
 * The part of a multi-step instruction that is actually a question.
 *
 * The first version passed the whole thing, and the notebook answered the
 * INSTRUCTION rather than the sources: *"I operate strictly within this active
 * notebook interface, meaning I cannot create a new notebook project called 'AI
 * Learning', push videos to other projects, or send messages to Telegram."*
 * Perfectly reasonable, and useless — it was asked to do the plan, not to read
 * the video.
 *
 * So the clauses about moving things around come off, and what is left is the
 * thing to ask. Cut rather than rewritten: a paraphrase would change the
 * question Grant asked, and the answer is quoted back to him.
 */
function askablePart(instruction: string): string {
  const cleaned = instruction
    // The scaffolding clauses. Each is an instruction to this system about
    // where things go, not a question about their contents.
    .replace(/\bpush (?:this|that|the) [a-z]+ into[^,.]*/gi, '')
    .replace(/\binto a new[^,.]*project[^,.]*/gi, '')
    .replace(/\breport back to me (?:here )?(?:in|on) \w+,?/gi, 'tell me')
    .replace(/\b(?:and )?(?:then )?find me the transcriptions?,?/gi, '')
    .replace(/\bhere in telegram,?/gi, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/\bthank you\b\.?/gi, '')
    .replace(/\s*,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .replace(/^[\s,;.]+|[\s,;]+$/g, '')
    .trim()

  // If cutting left nothing usable, ask the original. A bad question beats no
  // question: the notebook's answer is at least about the sources, and Grant
  // can see what was asked.
  return cleaned.length < 12 ? instruction.trim() : cleaned
}

/**
 * The plan, or null when the instruction is not multi-step.
 *
 * Null is not a failure: a one-step instruction is better served by doing it
 * and saying so than by asking permission to do one thing. The threshold is
 * two steps, and a step that only exists because a project had to be created
 * does not count towards it — "add this to a new project called X" is one
 * intention.
 */
export function readPlan(instruction: string): Plan | null {
  const steps: Step[] = []

  const found = NEW_PROJECT.exec(instruction) ?? NAMED_PROJECT.exec(instruction)
  const projectName = found === null ? null : String(found[1]).trim()
  // `project`, not `create_project`. Whether it exists is a fact about the
  // world and this function does not touch the world.
  if (projectName !== null) steps.push({ kind: 'project', name: projectName })

  const links = linkRequest(instruction)
  if (links !== null && links.intent !== 'discuss') {
    for (const link of links.links) {
      steps.push(
        link.kind === 'notebooklm' || link.kind === 'notion'
          ? { kind: 'attach', link }
          : { kind: 'add_source', link },
      )
    }
  }

  const artifacts = notebookRequest(instruction)
  if (artifacts !== null) {
    for (const artifact of artifacts.kinds) steps.push({ kind: 'generate', artifact })
  }

  // The question, last, because it is asked OF the sources and the sources
  // arrive in the steps above. Ordering is not cosmetic here: asking before the
  // video is transcribed gets a confident answer about nothing.
  if (WANTS_AN_ANSWER.test(instruction) && (links !== null || THE_TRANSCRIPT.test(instruction))) {
    steps.push({ kind: 'ask', question: askablePart(instruction) })
  }

  // One intention is not a plan. Creating a project is scaffolding for whatever
  // follows, so it does not earn its own step towards the threshold.
  const substantive = steps.filter(
    (s) => s.kind !== 'project' && s.kind !== 'create_project' && s.kind !== 'use_project',
  )
  if (substantive.length < 2) return null

  return {
    steps,
    project: projectName ?? links?.namedProject ?? null,
    instruction: instruction.trim(),
  }
}

/**
 * The plan, in Grant's words rather than the system's.
 *
 * Numbered, because he has to be able to say "not step 3". Quoting the
 * instruction back first, because the thing he asked for was confirmation that
 * it was UNDERSTOOD — and a list of steps with no restatement leaves him
 * checking a plan against his memory of what he said thirty seconds ago into a
 * phone.
 */
export function describePlan(plan: Plan): string {
  const lines = plan.steps.map((step, i) => {
    const n = `${String(i + 1)}.`
    switch (step.kind) {
      case 'project':
        // Unresolved. Only reachable if a caller describes a plan without
        // resolving it first, which is a bug — and one that should read as a
        // question rather than as a decision.
        return `${n} Work on “${step.name}” — I will check whether that already exists.`
      case 'use_project':
        return `${n} Use your existing “${step.name}” notebook.`
      case 'create_project':
        return (
          `${n} ⚠️ Start a BRAND NEW project called “${step.name}” with a new notebook — ` +
          'you have nothing by that name. Say so if you meant an existing one.'
        )
      case 'ambiguous_project':
        // Named rather than counted. "That matches 2 projects" makes him go and
        // look; naming them lets him answer from where he is standing.
        return (
          `${n} ❓ You said “${step.name}”, and I already have ` +
          `${step.candidates.map((c) => `“${c.name}”`).join(' and ')}. ` +
          'Which one — or is this a new one?'
        )
      case 'attach':
        return `${n} Attach that ${step.link.kind === 'notion' ? 'Notion page' : 'notebook'} to it.`
      case 'add_source':
        return `${n} Put ${step.link.url} into the notebook and wait for Google to read it — a video gets transcribed, which takes a few minutes.`
      case 'generate':
        return `${n} Make ${KIND_LABEL[step.artifact]} from it. I will ask you before I do.`
      case 'ask':
        return `${n} Read what it says and answer you here.`
      default:
        return `${n} —`
    }
  })

  return [
    `Let me say that back. You want:\n`,
    ...lines,
    '',
    'Go ahead and I will start. Say what to change if I have it wrong.',
  ].join('\n')
}

/** True when the plan will create something in Grant's Google account. */
export const createsSomething = (plan: Plan): boolean =>
  plan.steps.some((s) => s.kind === 'create_project')

/**
 * True when the plan cannot proceed until Grant answers a question in it.
 *
 * Distinct from `createsSomething`, which is about consequence. This is about
 * possibility: an ambiguous project creates nothing and costs nothing, and it
 * still cannot run, because there is no way to file the work.
 */
export const needsGrantToChoose = (plan: Plan): boolean =>
  plan.steps.some((s) => s.kind === 'ambiguous_project')

/** The link a plan's `ask` step should be answered against, if any. */
export const firstSource = (plan: Plan): FoundLink | null => {
  for (const step of plan.steps) if (step.kind === 'add_source') return step.link
  return null
}

/** Exported for the tests, which check the classifier and the plan agree. */
export { classifyLink }
