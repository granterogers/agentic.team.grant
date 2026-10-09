/**
 * The conversation a Team HQ turn belongs to (H1).
 *
 * `app.conversation_before` and `app.open_questions_for_reply` thread on the part of `origin_ref` before the first colon
 * (the "chat"), together with the office, the channel and the speaker. The Team HQ pages used to put a per-VISIT id there
 * (`s<random>`, minted at page load), so a reload, a second tab or a second device started a conversation with no
 * antecedent: "Yes, do that." lost the thing it said yes to, while Telegram and Slack, whose chat id is a durable thing,
 * kept theirs.
 *
 * The durable identity is derived HERE, on the server, from facts the page cannot choose: the verified speaker's office
 * and actor. The page's own session id is still sent and still goes into the dedupe key (that is what containment reads,
 * and what keeps two turns from looking like one webhook); it just stops being the conversation.
 *
 * Isolation is by construction and does not rest on this key alone (the readers also filter on office and speaker), but
 * this key carries office and speaker too, so a head can never be shared by two people or two offices:
 *   - another person  -> another actor  -> another head;
 *   - another office  -> another office -> another head;
 *   - another project -> a different `/<project>` suffix (the existing #373 rule), so a project never reads another's.
 *
 * A session that is not the page's own shape (a harness: `verify-...`, `probe...`) is NOT made durable. Giving a test the
 * person's thread would put its words in front of the person's next real turn, and it would let a harness "yes" reach a
 * real question. It keeps the per-visit head it always had.
 */

/** The shape `app.harness_voice_session` (0598) treats as the dashboard's own: `s` + base36, up to ten. */
export const PAGE_SESSION = /^s[a-z0-9]{1,10}$/

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

export type ConversationKeyInput = {
  readonly office: string
  readonly actor: string
  /** `service` is the office key, which only ever speaks in a declared test session. */
  readonly kind: 'person' | 'harness' | 'service'
  /** The id the page minted for this visit. Shaped by the caller; checked again here. */
  readonly session: string
  /** The project the page named, already shaped as a uuid, or null. */
  readonly project: string | null
}

/** The durable, person-and-office scoped head, with no project. Exposed so tests can assert what it is made of. */
export const durableHead = async (office: string, actor: string): Promise<string> => {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`hq-conversation\n${office.toLowerCase()}\n${actor}`),
    ),
  )
  return `hq${hex(bytes).slice(0, 32)}`
}

/** A page-minted message id: bounded and plain, so it can be neither a long payload nor anything that needs escaping. */
export const MESSAGE_ID = /^[A-Za-z0-9_-]{8,64}$/

/**
 * The per-turn part of the dedupe key and `origin_ref`, for a message the page NAMED at send time. The same message
 * replayed (a retry after a timeout) names itself again and so maps to the same turn; a different message has a
 * different id and so a different turn. The hash carries office, speaker and project, so the same id from another
 * person, another office or into another project is another turn and can never dedupe against this one.
 *
 * Returns null when the id is absent or malformed: the caller then mints a fresh turn id (old pages keep working).
 * 24 lower-case hex characters, which is inside the `[a-z0-9]+` the dashboard door's key shape allows.
 */
export const messageTurn = async (input: {
  readonly office: string
  readonly actor: string
  readonly project: string | null
  readonly message: unknown
}): Promise<string | null> => {
  if (typeof input.message !== 'string' || !MESSAGE_ID.test(input.message)) return null
  if (input.office === '' || input.actor === '') return null
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(
        `hq-message\n${input.office.toLowerCase()}\n${input.actor}\n${input.project ?? ''}\n${input.message}`,
      ),
    ),
  )
  return hex(bytes).slice(0, 24)
}

/**
 * The first segment of `origin_ref` (everything before the turn id): the conversation head, with `/<project>` when the
 * page names a project. Never contains a colon.
 */
export const conversationHead = async (input: ConversationKeyInput): Promise<string> => {
  const durable =
    input.kind !== 'service' &&
    PAGE_SESSION.test(input.session) &&
    input.office !== '' &&
    input.actor !== ''
  const head = durable ? await durableHead(input.office, input.actor) : input.session
  return input.project === null ? head : `${head}/${input.project}`
}
