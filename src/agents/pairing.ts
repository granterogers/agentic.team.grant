/**
 * Two messages that are one instruction.
 *
 * Grant sent a voice note to Emma — *"push this video into a new notebook
 * project called AI Learning, then find me the transcription and report back
 * all the repositories that are mentioned"* — and, as a separate message, the
 * link. That is how sharing works on a phone: you tap Share on the video, pick
 * the chat, and then you say what you want done with it. Two messages, seconds
 * apart, one intention.
 *
 * The system read them as two instructions. The bare link became "deal with
 * this" — which is the right reading of a bare link — and with one active
 * project it went into that project. The voice note, arriving without a URL,
 * described what to do with a video the handler could not see. Both halves
 * behaved correctly and the result was wrong: the video is in the wrong
 * notebook and the plan was never formed.
 *
 * ## The rule
 *
 * A message is a fragment when it is only a link, or when it points at
 * something it does not contain — "this video", "that link", "the one I just
 * sent". A fragment is completed by the nearest other fragment from the same
 * person, in the same chat, within a few minutes, that supplies what it lacks.
 *
 * Both directions, because both orders happen. Share-then-explain is more
 * common; explain-then-share is what you do when you are already typing.
 *
 * ## Why the window is minutes and not hours
 *
 * A link sent twenty minutes after an instruction is a new subject. The cost of
 * joining too eagerly is an instruction applied to the wrong link, which is
 * silent and permanent; the cost of joining too rarely is the behaviour we
 * already have, which is visible. So the window is short on purpose.
 *
 * ## Why this is not in the adapter
 *
 * §1: *"never pre-digested by the adapter."* An adapter that merged two
 * messages would be an adapter deciding what an instruction is. This runs in
 * the handler, against `inbound_commands`, where the merge is a recorded
 * decision rather than a lost message.
 */

/** How far back to look for the other half. */
export const PAIRING_WINDOW_MINUTES = 6

const URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/i

/**
 * Pointing at something the message does not contain.
 *
 * "This video", "that link", "the one I just sent". Deliberately requires the
 * demonstrative to be attached to a noun: a bare "this" appears in ordinary
 * prose constantly ("this is fine"), and treating that as a fragment would pair
 * unrelated messages.
 */
const POINTS_AT_SOMETHING =
  /\b(?:this|that|the)\s+(?:video|link|url|page|article|clip|one|file|pdf|doc(?:ument)?|episode|talk|paper)\b|\b(?:i\s+)?just\s+sent\b|\bthe\s+one\s+i\s+sent\b/i

export interface Fragment {
  /** True when the message carries a link and (almost) nothing else. */
  readonly isBareLink: boolean
  /** True when the message describes work on something it does not contain. */
  readonly needsALink: boolean
}

/**
 * What kind of half, if either, this message is.
 *
 * A message that has both a link and instructions is complete and is neither
 * half — that is the common case and must stay cheap.
 */
export function readFragment(text: string): Fragment {
  const trimmed = text.trim()
  const link = URL_PATTERN.exec(trimmed)
  const hasLink = link !== null

  if (hasLink) {
    // "Bare" allows the words people put around a shared link — "this:",
    // "have a look", a stray emoji — but not an instruction. Measured against
    // the real message, which was the URL and nothing else; the tolerance is
    // for the next one.
    const withoutLink = trimmed
      .replace(URL_PATTERN, '')
      .replace(/[\s:,.\-—]+/g, ' ')
      .trim()
    return { isBareLink: withoutLink.length <= 24, needsALink: false }
  }

  return { isBareLink: false, needsALink: POINTS_AT_SOMETHING.test(trimmed) }
}

/**
 * The two halves joined, in the order a person would have typed them.
 *
 * The instruction first and the link appended, because every reader downstream
 * — the planner, the link classifier, the model — is written for "do this with
 * that URL" and not for "that URL, do this". Producing the shape the rest of
 * the system already handles is the whole value of joining them here.
 */
export const join = (instruction: string, link: string): string =>
  `${instruction.trim().replace(/\s+$/, '')} ${link.trim()}`
