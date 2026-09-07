/**
 * Taking the furniture out of a web page.
 *
 * Grant, on the notebook: *"there's some really odd looking files there. So
 * inspect the content, make sure everything's seen."* Inspecting them turned up
 * something worse than an odd file: the Wikipedia article in his corpus is
 * 69,000 characters and the first four thousand are the navigation menu. Every
 * word of it is indexed and every one is citable.
 *
 * It had already been read back to him. Asked who regulates coaching, Emma
 * answered *"the excerpt you see is just the page navigation, so it doesn't
 * answer that question"* — which was the right answer and should not have been
 * necessary.
 *
 * ## What this removes, and the rule behind each
 *
 * Only things that cannot be prose:
 *
 *   - **A line that is nothing but a URL.** Web extractors emit the href under
 *     every link, so a page with two hundred links has two hundred of these.
 *     They are the single biggest contributor and the safest to drop: a
 *     sentence is not a bare URL.
 *   - **A short label whose very next line is that link's URL.** This is the
 *     shape a menu has after extraction: `Main page` then
 *     `https://en.wikipedia.org/wiki/Main_Page`. Prose is never followed by its
 *     own href.
 *
 *     The first version used "a run of short lines" instead, on the theory that
 *     menus are lists of two-word links. It was measured against the actual
 *     document and was badly wrong: this extractor hard-wraps prose too, so the
 *     article averages thirty-five characters a line and the rule wanted to
 *     delete two thirds of it. The guard below caught that and refused, which
 *     is the only reason it was noticed rather than shipped.
 *   - **Named furniture.** "Jump to content", "move to sidebar", "Retrieved
 *     from", "Privacy policy". A short list, matched whole-line only, because a
 *     substring match on "Contents" would eat a real heading.
 *
 * ## What it deliberately does not do
 *
 * It does not summarise, rewrite, or reflow. §10's citations are built on the
 * stored text being what the source said, so this only ever DELETES lines, and
 * only lines it can name a rule for. A cleaner that paraphrased would make
 * every quotation in the system approximate.
 *
 * It also refuses to run away with itself: if the rules would remove more than
 * `MAX_REMOVED_FRACTION` of the text, nothing is removed and the original is
 * kept. That case is not a very navigational page, it is a page this code does
 * not understand — a transcript, a table, a poem — and the failure mode of
 * guessing there is a corpus with the content stripped out and the furniture
 * left in.
 */

/**
 * Beyond this, assume the rules are wrong about this document, not the document.
 *
 * Raised from 0.6 after measuring it against the real thing. A Wikipedia
 * article genuinely is mostly links after extraction — every href on its own
 * line, every label above it — so losing four fifths of the bytes is the rule
 * working, not the rule failing. The original ceiling refused the one document
 * this was written for.
 *
 * The ceiling still earns its place, but the floor below is what actually
 * protects against gutting: what matters is whether anything substantial is
 * LEFT, not how much went.
 */
export const MAX_REMOVED_FRACTION = 0.92

/**
 * And whatever the fractions say, this much prose has to survive — unless the
 * document never had it.
 *
 * A page reduced to a title and two headings has been destroyed. A short page
 * reduced to its one real paragraph has not, and an absolute floor alone
 * cannot tell those apart: it refused a 900-character fixture that had cleaned
 * perfectly. So the floor applies only when what remains is also a tiny
 * fraction of what there was — both conditions, because either alone is wrong
 * on a document the other one handles.
 */
export const MIN_KEPT_CHARS = 400
const GUTTED_FRACTION = 0.15

/** A line that is only a link. */
const BARE_URL = /^\s*(?:https?:\/\/|www\.)\S+\s*$/i

/** Whole-line furniture, not substrings. */
const FURNITURE =
  /^\s*(?:jump to (?:content|navigation|search)|move to sidebar(?: hide| show)?|hide|show|\[-\]|\[edit\]|edit|toggle .* subsection|retrieved from|privacy policy|about wikipedia|disclaimers|contact us|code of conduct|mobile view|main menu|navigation menu|personal tools|search|from wikipedia, the free encyclopedia)\s*$/i

/** A link label is short and does not end a sentence. */
const LABEL_MAX = 60
const ENDS_A_SENTENCE = /[.!?:;,]\s*$/

/**
 * Strip the furniture, or give up and change nothing.
 *
 * Returns the text and what it did, because a caller that stores the result
 * should be able to record whether cleaning happened — a corpus where some
 * documents are cleaned and some are not, with no way to tell which, is a
 * corpus whose quality nobody can reason about.
 */
export function stripBoilerplate(text: string): {
  readonly text: string
  readonly removedLines: number
  readonly removedChars: number
  readonly applied: boolean
  /** Why nothing was changed, when the rules matched but were overruled. */
  readonly refused?: string | null
} {
  const lines = text.split('\n')
  const drop = new Array<boolean>(lines.length).fill(false)

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (BARE_URL.test(line) || FURNITURE.test(line)) drop[i] = true
  }

  // The label above a dropped URL. Second pass, because it reads the FIRST
  // pass's decisions: a line is a menu item when the line after it is the link
  // it points at, and that is only known once the URLs are marked.
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (drop[i] === true) continue
    const next = lines[i + 1] ?? ''
    if (!BARE_URL.test(next)) continue
    const label = (lines[i] ?? '').trim()
    if (label === '' || label.length > LABEL_MAX) continue
    if (ENDS_A_SENTENCE.test(label)) continue
    drop[i] = true
  }

  const kept: string[] = []
  let removedLines = 0
  let removedChars = 0
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? ''
    if (drop[i] === true) {
      removedLines += 1
      removedChars += line.length + 1
      continue
    }
    kept.push(line)
  }

  const cleaned = kept
    .join('\n')
    // Collapse the holes the removals leave, so the result reads as a document
    // rather than as one with pieces cut out of it.
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // The guards. Either one firing means the rules do not understand this
  // document, and the honest response is to leave it alone.
  //
  // `removedChars` is reported EITHER WAY. The first version zeroed it on
  // refusal, so a caller investigating why nothing had changed was told
  // "nothing matched" when in fact everything had matched and been refused —
  // two very different problems with one symptom, which cost an hour.
  const gutted =
    cleaned.length < MIN_KEPT_CHARS &&
    text.length >= MIN_KEPT_CHARS &&
    cleaned.length / text.length < GUTTED_FRACTION
  const tooMuch = text.length > 0 && removedChars / text.length > MAX_REMOVED_FRACTION
  if (gutted || tooMuch) {
    return {
      text,
      removedLines,
      removedChars,
      applied: false,
      refused: gutted ? 'would leave nothing substantial' : 'would remove almost all of it',
    }
  }

  return {
    text: cleaned,
    removedLines,
    removedChars,
    applied: removedChars > 0,
    refused: null,
  }
}
