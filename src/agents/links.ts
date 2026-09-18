/**
 * Reading a link the way a colleague would.
 *
 * Grant: *"maybe I'd want to send a link to the Chief of Staff in Telegram or
 * Slack — let's say it's a YouTube link on the history of coaching — and we
 * just send him that link and say, add that to the project. Now he'd have to
 * obviously be smart enough to know: to which project are we uploading it? Are
 * we uploading it to Google Notebook? Are we uploading it to Notion? What do
 * you want me to do with it? So there should be some contextual awareness."*
 *
 * Three questions in that, and they have different kinds of answer.
 *
 * ## Which destination — decided by what the link IS
 *
 * A NotebookLM or Notion URL is a PLACE. Nobody sends you a link to a notebook
 * meaning "read this notebook"; they mean "this is where the project lives".
 * So those attach as project surfaces.
 *
 * Everything else — a YouTube video, an article, a PDF — is CONTENT, and
 * content goes into the notebook. Not a coin toss: ADR-0013 settled it as
 * *"Notion stores, NotebookLM generates"*, and NotebookLM ingests a URL
 * natively while Notion would need us to fetch, render and paste. The same
 * link into both would be the duplication Grant asked us to avoid.
 *
 * ## Which project — decided by what is there
 *
 * Named in the message, or the only active one, or a question. Never a guess
 * between two, because a source filed into the wrong project is invisible: it
 * is present, it is searchable, and it quietly answers questions about the
 * wrong thing.
 *
 * ## What to do with it — decided by the verb, and by the link when there is no verb
 *
 * "Add this to the project" and a bare pasted link mean the same thing, because
 * that is how people use chat. A link with a question about it does not.
 *
 * ## Why this is a table and not a model
 *
 * Same reason as `actions.ts`: the side effect is real and lands in Grant's
 * notebook. A model misreading "what did you think of this?" as "add this"
 * costs a source nobody wanted and a slice of a compute allowance we cannot
 * even measure (0078). A table misreading it costs a prose answer, and he
 * rephrases.
 */

/** What a URL is, as far as this system is concerned. */
export type LinkKind = 'notebooklm' | 'notion' | 'youtube' | 'web'

export interface FoundLink {
  readonly url: string
  readonly kind: LinkKind
  /**
   * The identifier inside the URL, for the kinds where we need one.
   *
   * A NotebookLM attachment is keyed on the notebook id and not on the URL: the
   * same notebook has several URLs (with and without the trailing slash, with
   * a `?authuser=`), and attaching by URL would attach it twice.
   */
  readonly ref: string
}

/** What the sender appears to want done. */
export type LinkIntent = 'attach' | 'add_source' | 'discuss'

export interface LinkRequest {
  readonly links: readonly FoundLink[]
  readonly intent: LinkIntent
  /** A project named in the message, lowercased, or null. */
  readonly namedProject: string | null
}

// Deliberately greedy about what counts as a URL and strict about what counts
// as an instruction. A missed link is a prose answer; a fabricated one is a
// fetch of something nobody sent.
const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/gi

const NOTEBOOK_ID = /notebooklm\.google\.com\/notebook\/([0-9a-f-]{16,})/i
const NOTION_ID = /(?:notion\.so|notion\.site)\/(?:[^/\s]+\/)?(?:[^/\s?#]*?-)?([0-9a-f]{32})/i
const YOUTUBE = /(?:youtube\.com\/(?:watch\?|shorts\/|live\/)|youtu\.be\/)/i

/** Trailing punctuation a person's sentence leaves stuck to a pasted URL. */
const trim = (url: string): string => url.replace(/[.,;:!?)\]]+$/, '')

import { pageRequest } from './actions.ts'

export function classifyLink(raw: string): FoundLink {
  const url = trim(raw)
  const notebook = NOTEBOOK_ID.exec(url)
  if (notebook !== null) {
    return { url, kind: 'notebooklm', ref: String(notebook[1]) }
  }
  const notion = NOTION_ID.exec(url)
  if (notion !== null) {
    return { url, kind: 'notion', ref: String(notion[1]) }
  }
  // YouTube is called out from `web` because it is the case Grant named, and
  // because it is worth saying "the video" rather than "the link" back to him.
  // The notebook ingests it by URL either way.
  return { url, kind: YOUTUBE.test(url) ? 'youtube' : 'web', ref: url }
}

/** Asking about a link rather than asking for something to be done with it. */
const DISCUSSING =
  /\b(what do you (think|make)|thoughts?\b|is this any good|have a look|summar(y|ise|ize)|read this and|any good\?)/i

/** Doing something with it. Also the default for a bare link — see the header. */
const ADDING = /\b(add|attach|include|upload|put|file|save|store|ingest|import|use)\b/i

/**
 * A project named in the message.
 *
 * Only inside quotes or after "to the … project" / "in <name>". A bare noun is
 * not a project name — "add this to the notebook" names a destination, not a
 * project — and treating it as one is how a source lands somewhere plausible
 * and wrong.
 */
const NOT_A_NAME = new Set([
  // Grammar, not names. "Add this to the project" names no project — it means
  // *the* project, the one we are obviously talking about — and reading "the"
  // as a name produced exactly that reply on the first live message: *"I do not
  // have a project called 'the'."*
  'the',
  'a',
  'an',
  'this',
  'that',
  'it',
  'our',
  'my',
  'your',
  'main',
  // Destinations, not projects. "Add this to the notebook" says where it goes.
  'project',
  'notebook',
  'notion',
])

function clean(value: string): string | null {
  const name = value.trim().toLowerCase().replace(/\s+/g, ' ')
  return name === '' || NOT_A_NAME.has(name) ? null : name
}

function namedProject(text: string): string | null {
  const quoted = /["“”']([^"“”']{2,60})["“”']/.exec(text)
  if (quoted !== null) {
    const name = clean(String(quoted[1]))
    if (name !== null) return name
  }
  const phrase = /\b(?:to|in|on|for)\s+(?:the\s+)?([a-z0-9][a-z0-9 &._-]{1,48}?)\s+project\b/i.exec(
    text,
  )
  if (phrase !== null) {
    const name = clean(String(phrase[1]))
    if (name !== null) return name
  }
  const project = /\bproject\s+["“']?([a-z0-9][a-z0-9 &._-]{1,48}?)["“']?\s*$/i.exec(text.trim())
  return project === null ? null : clean(String(project[1]))
}

/**
 * The links in a message and what to do with them, or null when there are none.
 *
 * Null is the common case and must stay cheap: every message to every bot comes
 * through here.
 */
export function linkRequest(message: string): LinkRequest | null {
  const found = message.match(URL_PATTERN)
  if (found === null || found.length === 0) return null

  const links = found.map(classifyLink)
  const text = message.toLowerCase()

  // Order matters and this way round is deliberate. "Have a look at this and
  // add it" is an instruction with a pleasantry in front of it; a message that
  // only asks a question is not.
  /*
    An explicit request to READ it is not a request to FILE it (#135).

    `DISCUSSING` was an enumeration — it wanted the literal "read this and" —
    so "Read https://example.com/ and tell me what it says" matched nothing and
    fell through to the default, and the office answered a request to read a
    page with "putting it into the notebook and waiting for Google to read it".
    Found by driving the real path end to end; no unit test here could see it,
    because both halves were correct on their own.

    `pageRequest` is the shared predicate rather than a widened pattern here,
    for the reason #258 gives about the artifact matchers: two regexes deciding
    the same thing by eye is how they come to disagree, and deference between
    them is a cycle. A bare link is still `add_source`, which is what it has
    always meant and what `why: 'bare'` preserves; ADDING still wins outright,
    because "read this and add it to the notebook" is an instruction to add it.
  */
  const asksToRead = pageRequest(message)?.why === 'asked'

  const intent: LinkIntent = ADDING.test(text)
    ? links.every((l) => l.kind === 'notebooklm' || l.kind === 'notion')
      ? 'attach'
      : 'add_source'
    : asksToRead || DISCUSSING.test(text)
      ? 'discuss'
      : // A bare link with no verb. People paste a link at a colleague meaning
        // "deal with this", and the destination rule below is what makes that
        // safe to act on: a notebook link becomes a place, anything else
        // becomes a source, and neither is destructive.
        links.every((l) => l.kind === 'notebooklm' || l.kind === 'notion')
        ? 'attach'
        : 'add_source'

  return { links, intent, namedProject: namedProject(message) }
}

/** What to call a link in a sentence to a person. */
export const LINK_LABEL: Record<LinkKind, string> = {
  notebooklm: 'NotebookLM notebook',
  notion: 'Notion page',
  youtube: 'YouTube video',
  web: 'link',
}
