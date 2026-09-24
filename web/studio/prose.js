/*
  The one renderer for a message body, shared by the studio and the
  Basecamp-inspired experience so the two cannot disagree about what a
  newline means. Moved verbatim out of app.js; its history is below.
*/
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/*
  A message body, with its line breaks intact (#209).

  HTML collapses whitespace, so a body rendered as one escaped string inside a
  single paragraph tag loses every newline in it. That is what the studio did,
  and it means #186's whole outcome — two or three short paragraphs, one
  thought each, instead of a wall — has NEVER been visible here. The model was
  writing it, Telegram and Slack were showing it, and this surface ran it all
  together into one block.

  Grant asked for numbered lists on 14 September and that is what made it
  visible: a three-item list arrives as one line reading 1. first 2. second
  3. third, which is worse than the prose it replaced.

  Blank line starts a paragraph; a single newline is a line break inside one.
  That is the whole rule, and it is deliberately NOT a markdown renderer — §5
  says an adapter may only translate, and the three surfaces have three markup
  languages. The model writes one plain-text body; each surface renders the
  breaks in its own. Telegram and Slack already did.

  Escaped first, then the tags are added, for the reason the Telegram escaper
  gives: convert-then-escape turns the tags you just added into visible text.
*/
const NUMBERED = /^\s*(\d+)[.)]\s+(.*)$/
export const prose = (s) =>
  String(s ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .split(/\n{2,}/)
    .map((para) => {
      const lines = para.split('\n')
      const items = lines.map((l) => NUMBERED.exec(l))
      /*
        A paragraph whose every line is numbered becomes a real list.

        Line breaks alone were not enough, and the phone capture is what
        showed it: with each item on its own line but wrapping at 390px, the
        continuation of item 1 started in exactly the column item 2 started
        in, so three items read as five and the shape Grant asked for was
        gone at the width he reads on.

        An ordered list gets the hanging indent for nothing, and it gets the
        semantics too — a screen reader says "list, 3 items" before reading
        them, which is the same affordance the thread itself gained in #200.

        Still not a markdown renderer, and the distinction is the one in
        section 5: this translates a line break into the markup THIS surface
        uses for it. Telegram and Slack translate the same body into theirs.
        Nothing here parses emphasis, links or headings.

        The literal number is dropped and replaced by the start attribute, so
        a model that begins at 1 gets 1 and a model that continues from 4
        gets 4 — but a model that writes 1, 2, 2, 5 gets a list that counts
        properly rather than a transcription of its mistake.
      */
      if (lines.length >= 2 && items.every((m) => m !== null)) {
        const from = Number(items[0][1])
        return `<ol class="msglist"${from === 1 ? '' : ` start="${from}"`}>${items
          .map((m) => `<li>${esc(m[2])}</li>`)
          .join('')}</ol>`
      }
      return `<p>${esc(para).replace(/\n/g, '<br>')}</p>`
    })
    .join('')
