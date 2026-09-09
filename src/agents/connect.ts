/**
 * Reading "wire this up" as a thing to do.
 *
 * ## The exchange this comes from
 *
 * Grant, to the Chief of Staff: *"there is only one current notion teamspace
 * you have access to already, so i don't think you need the iD.. and it has no
 * active projects ATM .. otherwise, good to go."* And a minute later: *"just
 * work with what you have for now."*
 *
 * The message reached the right project. Then nothing happened. Answering about
 * Notion was possible and, since 0163, writing to it was too — but "attach this
 * project to the Notion you already have" is a **configuration change**, and the
 * only thing that could make one was me running a script from a terminal.
 *
 * Which is the whole objection. His words about the system as a whole: *"I want
 * to reduce my dependence on Claude or another coding interface for maintaining
 * and extending the system."* A capability that exists only as a CLI I invoke
 * is a capability he does not have.
 *
 * ## Why a table and not a model
 *
 * The same reasoning as `actions.ts`: this starts a side effect on his real
 * workspace, and the failure mode of a model deciding is a project silently
 * rewired because a sentence mentioned Notion. The failure mode of a table is
 * that an unusual phrasing gets a prose answer, which is recoverable by saying
 * it again.
 *
 * And the same two guards as `notebookRequest`, for the same reason: a
 * twenty-five-line brief that mentions Notion in passing is not a request to
 * reconfigure anything.
 *
 * ## What this deliberately does NOT catch
 *
 * Grant's actual two messages were *"there is only one current notion teamspace
 * you have access to already, so i don't think you need the iD.. and it has no
 * active projects ATM .. otherwise, good to go"* and *"just work with what you
 * have for now"*.
 *
 * The second names nothing at all — "what you have" only means Notion because
 * of the message before it — and the first is an answer to a question the agent
 * had asked, with no verb in it. Neither is reachable by a table over one
 * message, and stretching the patterns until they matched would mean matching
 * an enormous amount else besides.
 *
 * So this catches the explicit phrasings and does not pretend to the rest. The
 * conversational case belongs to a different mechanism: a project already reads
 * `wanted` for Notion (0163), which is a specific outstanding question, and
 * resolving assent against a pending question is conversation state rather than
 * pattern matching. Named here so the gap is a known one rather than a
 * surprise.
 */

/** What the message is asking to be connected. */
export type Connectable = 'notion'

export interface ConnectRequest {
  readonly what: Connectable
  /** A teamspace or workspace named in the message, when one is. */
  readonly named: string | null
}

/**
 * The verbs that mean "make the connection", as opposed to talking about it.
 *
 * `use` earns its place because of the actual sentence: *"just work with what
 * you have for now"* is a use, and *"there is only one teamspace you have
 * access to"* is a statement that only makes sense as an instruction to use it.
 */
const WIRE_UP =
  /\b(?:connect|attach|link|hook(?:\s+it)?\s+up|wire(?:\s+it)?\s+up|set\s+up|point\s+(?:it|this|us)|use|work\s+with)\b/i

/** Talking about it, which must not trigger anything. */
const ASKING_ABOUT =
  /\b(?:can|could|should|would|do|does|did|is|are|why|what|which|how|when|whether)\b[^.?!]{0,50}\?/i

const NOTION = /\bnotion\b/i

/**
 * A brief is not a configuration change.
 *
 * Same shape and same thresholds as the guard in `actions.ts`, and duplicated
 * deliberately rather than shared: these two tables answer different questions
 * and a change to one should not silently move the other.
 */
const looksLikeABrief = (instruction: string): boolean => {
  const bullets = (instruction.match(/^\s*(?:[-*•]|\d+[.)])\s+\S/gm) ?? []).length
  const sentences = (instruction.match(/[.!?](?:\s|$)/g) ?? []).length
  const lines = instruction.split('\n').filter((l) => l.trim() !== '').length
  return bullets >= 3 || sentences >= 6 || lines >= 8
}

/**
 * The teamspace or workspace named, if one is named.
 *
 * Quoted first, because a quoted phrase is unambiguous. Then the words
 * immediately before "teamspace", which is how people actually say it — "the
 * Legacy Coaching Course teamspace".
 *
 * Null is a perfectly good answer and the commonest one: with a single
 * teamspace shared, "use what you have" needs no name at all.
 */
export const namedSpace = (instruction: string): string | null => {
  const quoted = /["“']([^"”']{2,60})["”']\s*(?:teamspace|team space|workspace)/i.exec(instruction)
  if (quoted?.[1] !== undefined) return quoted[1].trim()
  const before = /\b((?:[A-Z][\w&'-]*\s+){1,4})(?:teamspace|team space|workspace)\b/.exec(
    instruction,
  )
  if (before?.[1] !== undefined) {
    const words = before[1].trim()
    // "the" and "our" are not names. Neither is "this" or "that".
    const cleaned = words.replace(/^(?:The|Our|This|That|A|An)\s+/i, '').trim()
    return cleaned === '' ? null : cleaned
  }
  return null
}

/**
 * Is this an instruction to wire a project up to something?
 *
 * Null for everything else, including questions about connections and briefs
 * that merely mention one.
 */
export function connectRequest(instruction: string): ConnectRequest | null {
  if (ASKING_ABOUT.test(instruction)) return null
  if (looksLikeABrief(instruction)) return null
  if (!NOTION.test(instruction)) return null
  if (!WIRE_UP.test(instruction)) return null
  return { what: 'notion', named: namedSpace(instruction) }
}

/**
 * Reading "populate Notion" as a thing to do, separately from "connect it".
 *
 * ## Why this is its own table
 *
 * Grant sent the Chief of Staff a long brief — *"use your connection to the
 * notebook 'Legacy Coaching Course' as a means to fully populate the
 * corresponding teamspace in Notion: so create tasks, fully populate docs…"* —
 * and got a paragraph back describing what it would do. Then, a day later,
 * looking at the teamspace: *"notion is still empty.. you need to check against
 * the results of what im asking."*
 *
 * `connectRequest` would not have caught it and should not: that one attaches
 * databases, and it deliberately refuses briefs, because a twenty-line brief
 * that mentions Notion in passing must not silently rewire a workspace.
 *
 * But a brief is exactly the shape this request arrives in. Populating is what
 * you ask for at length. So this one does NOT bail on length — it requires an
 * explicit fill verb aimed at Notion instead, which is the narrower filter and
 * the one that matches how the sentence was actually written.
 *
 * ## Still safe to be wrong about
 *
 * Every page it writes is matched on title first and left alone if it exists,
 * so the worst case of a false positive is pages appearing in a workspace he
 * asked to have pages in — recoverable, unlike attaching the wrong database.
 */
const FILL_UP =
  /\b(?:populate|fill(?:\s+(?:up|in|out))?|import|build\s+out|flesh\s+out|write\s+(?:it\s+)?(?:in)?to|push\s+(?:it\s+)?(?:in)?to|create\s+(?:the\s+)?(?:pages|docs|tasks|projects))\b/i

/**
 * Is this an instruction to put our material into Notion?
 *
 * Deliberately not gated on `looksLikeABrief`, unlike `connectRequest` — see
 * above. Still gated on being an instruction rather than a question.
 */
export function populateRequest(instruction: string): boolean {
  if (ASKING_ABOUT.test(instruction)) return false
  if (!NOTION.test(instruction)) return false
  return FILL_UP.test(instruction)
}
