/**
 * What a message said, and the three reasons it may not be held (#172).
 *
 * ADR-0038 reverses ADR-0037's metadata-only posture on Grant's explicit
 * authorisation, so this is where the narrowings that come with it are
 * checked. Every one of them has a control beside it, because a parser that
 * withheld everything would pass a suite made only of "it is not stored".
 */
import { describe, expect, it } from 'vitest'
import {
  decodeBody,
  heldBody,
  isBulk,
  type Part,
  stripQuoted,
  TOO_BIG,
  textFromHtml,
  textOf,
} from '../../src/google/body.ts'

/** base64url, which is what Gmail sends — not base64. */
const enc = (s: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

describe('decoding what Gmail actually sends', () => {
  it('reads base64url, padding and all', () => {
    expect(decodeBody(enc('Hello, world.'))).toBe('Hello, world.')
  })

  it('CONTROL: a body with the two substituted characters in it round-trips', () => {
    // `-` and `_` stand in for `+` and `/`. Feeding base64url to a plain base64
    // decoder does not throw — it returns plausible mojibake, which is the
    // failure that does not announce itself.
    const awkward = 'a?b>c~d{e}f|g'.repeat(9)
    expect(decodeBody(enc(awkward))).toBe(awkward)
  })

  it('reads UTF-8 rather than latin-1', () => {
    // Decoded as latin-1 this is "weâ€™ve agreed â€” March".
    expect(decodeBody(enc('we’ve agreed — March'))).toBe('we’ve agreed — March')
  })

  it('a leaf that is not decodable is empty rather than a throw', () => {
    expect(decodeBody('!!!not base64 at all!!!')).not.toContain('����')
  })
})

describe('finding the text in a MIME tree', () => {
  const plain = (text: string): Part => ({ body: { data: enc(text) }, mimeType: 'text/plain' })
  const html = (text: string): Part => ({ body: { data: enc(text) }, mimeType: 'text/html' })

  it('prefers the plain part over the HTML one', () => {
    const tree: Part = {
      mimeType: 'multipart/alternative',
      parts: [plain('the real words'), html('<p>the marked-up words</p>')],
    }
    expect(textOf(tree)).toBe('the real words')
  })

  it('falls back to the HTML part when there is no plain one', () => {
    expect(
      textOf({ mimeType: 'multipart/alternative', parts: [html('<p>Hello</p><p>there</p>')] }),
    ).toBe('Hello\nthere')
  })

  it('skips an attachment even when it is text', () => {
    /*
      An attachment is skipped by its FILENAME, not by its MIME type. A PDF is
      easy; a forwarded `.txt` arrives as `text/plain` with a filename and
      would otherwise be read as the letter.
    */
    const tree: Part = {
      mimeType: 'multipart/mixed',
      parts: [
        plain('Please see attached.'),
        { ...plain('CONFIDENTIAL SALARY BANDS'), filename: 'bands.txt' },
      ],
    }
    expect(textOf(tree)).toBe('Please see attached.')
    expect(textOf(tree)).not.toContain('SALARY')
  })

  it('a message with no text at all is empty, not a guess', () => {
    expect(textOf({ mimeType: 'image/png', parts: [] })).toBe('')
    expect(textOf(undefined)).toBe('')
  })

  it('strips scripts and styles out of HTML rather than reading them as words', () => {
    expect(textFromHtml('<style>.a{color:red}</style><p>Hello</p>')).toBe('Hello')
    expect(textFromHtml('<script>alert(1)</script><p>Hi</p>')).toBe('Hi')
  })
})

describe('the quoted reply chain', () => {
  it('cuts at the "On ... wrote:" header', () => {
    const text = stripQuoted(
      'Yes, Thursday works.\n\nOn 12 September 2026 at 14:03, Jane Smith <jane@x.com> wrote:\n> Can we move it?\n> Jane',
    )
    expect(text).toBe('Yes, Thursday works.')
  })

  it('cuts at the Outlook header block, which has no dashes', () => {
    expect(
      stripQuoted(
        'Agreed.\n\nFrom: Jane Smith\nSent: 12 September 2026 14:03\nTo: Grant\n\nCan we move it?',
      ),
    ).toBe('Agreed.')
  })

  it('cuts at a forwarded-message rule', () => {
    expect(stripQuoted('FYI.\n\n---------- Forwarded message ----------\nFrom: someone')).toBe(
      'FYI.',
    )
  })

  it('removes a trailing run of angle-quoted lines with no header', () => {
    expect(stripQuoted('No, the 24th.\n\n> the 17th?\n> please confirm')).toBe('No, the 24th.')
  })

  it('CONTROL: a letter with no quoting is kept whole', () => {
    // The rule errs towards keeping text. Losing what somebody actually wrote
    // is the worse direction, so a body with no marker is stored entire.
    const whole = 'Three things.\n\nOne, the price.\n\nTwo, the date.\n\nThree, the contract.'
    expect(stripQuoted(whole)).toBe(whole)
  })

  it('CONTROL: an angle bracket used mid-letter survives', () => {
    expect(stripQuoted('Revenue > costs, finally.\n\nSee you Thursday.')).toContain(
      'Revenue > costs',
    )
  })

  it('takes the EARLIEST marker, so a chain inside a chain does not survive', () => {
    const text = stripQuoted(
      'Latest.\n\nOn 12 Sep 2026 at 09:00, A <a@x.com> wrote:\nOlder.\n\n---------- Forwarded message ----------\nOldest.',
    )
    expect(text).toBe('Latest.')
    expect(text).not.toContain('Oldest')
  })
})

describe('mail the office deliberately does not read', () => {
  it('Gmail’s own categories decide, not a word list', () => {
    expect(isBulk(['CATEGORY_PROMOTIONS', 'INBOX'])).toBe(true)
    expect(isBulk(['CATEGORY_SOCIAL'])).toBe(true)
    expect(isBulk(['CATEGORY_FORUMS'])).toBe(true)
  })

  it('and a List-Unsubscribe header, whatever Gmail thought', () => {
    expect(isBulk(['INBOX'], [{ name: 'List-Unsubscribe', value: '<mailto:x@y>' }])).toBe(true)
    expect(isBulk(['INBOX'], [{ name: 'list-id', value: 'news.example.com' }])).toBe(true)
  })

  it('CONTROL: an ordinary message from a person is not bulk', () => {
    /*
      The control that matters most here. A bulk rule can be widened until it
      matches everything, and every "it was withheld" check goes on passing
      while the office holds nothing at all — which would look exactly like
      ADR-0037's posture never having been reversed.
    */
    expect(isBulk(['INBOX', 'UNREAD'], [{ name: 'From', value: 'jane@example.com' }])).toBe(false)
    expect(isBulk([])).toBe(false)
  })
})

describe('what is held, and why not', () => {
  const letter = (text: string): Part => ({
    body: { data: enc(text) },
    mimeType: 'text/plain',
  })

  it('holds an ordinary letter with its chain removed', () => {
    const held = heldBody(
      letter(
        'Confirmed for the 24th.\n\nOn 12 Sep 2026 at 09:00, Elena <e@x.com> wrote:\n> which day?',
      ),
      ['INBOX'],
    )
    expect(held.body).toBe('Confirmed for the 24th.')
    expect(held.withheld).toBeNull()
  })

  it('refuses bulk BEFORE decoding it', () => {
    const held = heldBody(letter('FIFTY PERCENT OFF'), ['CATEGORY_PROMOTIONS'])
    expect(held.body).toBeNull()
    expect(held.withheld).toBe('bulk')
  })

  it('says "no text part" rather than storing an empty string', () => {
    /*
      0177's sentinel, in a new column: an empty body would satisfy the
      not-null shape and lie. The three reasons a body is absent are different
      facts and a reader has to be able to tell them apart.
    */
    const held = heldBody({ mimeType: 'image/png' }, ['INBOX'])
    expect(held.body).toBeNull()
    expect(held.withheld).toBe('no text part')
  })

  it('refuses a letter past the ceiling, and says which reason', () => {
    const held = heldBody(letter('x'.repeat(TOO_BIG + 1)), ['INBOX'])
    expect(held.body).toBeNull()
    expect(held.withheld).toBe('too large')
  })

  it('CONTROL: a long-but-allowed letter is still held', () => {
    const held = heldBody(letter('y'.repeat(TOO_BIG - 1)), ['INBOX'])
    expect(held.body).not.toBeNull()
    expect(held.withheld).toBeNull()
  })

  it('a message that is only a quoted chain is "no text part", not empty text', () => {
    // Stripping can legitimately empty a body — a bare "+1" reply quoting
    // everything. The constraint forbids body '' with a null reason, so the
    // order of the checks in `heldBody` is load-bearing.
    const held = heldBody(letter('On 12 Sep 2026 at 09:00, A <a@x.com> wrote:\n> everything'), [
      'INBOX',
    ])
    expect(held.body).toBeNull()
    expect(held.withheld).toBe('no text part')
  })
})

/**
 * What the real inbox refuted (#172).
 *
 * Thirty live messages were fetched with the first version of this module.
 * Five of the fourteen held bodies still contained an "On ... wrote:"
 * attribution — and a query settled WHY in one go: **zero of them had it at
 * the start of a line**, out of five that had it at all. The matcher was
 * anchored `^...$`, so it could never have fired on an HTML message, and no
 * fixture in this file was HTML-derived.
 *
 * Both halves of the fix are checked here, because either alone leaves the
 * class open.
 */
describe('the quoted chain in HTML mail, which the fixtures missed', () => {
  it('cuts the blockquote out while it is still marked up', () => {
    const html =
      '<div>Yes, Thursday.</div><blockquote class="gmail_quote"><div>Can we move it?</div></blockquote>'
    expect(textFromHtml(html)).toBe('Yes, Thursday.')
  })

  it('cuts Gmail’s quote container even without a blockquote', () => {
    const html = '<div>Agreed.</div><div class="gmail_quote gmail_quote_container">older</div>'
    expect(textFromHtml(html)).not.toContain('older')
  })

  it('and the attribution is caught mid-line, which is where conversion puts it', () => {
    // The exact shape the live run produced: no newline before "On".
    expect(stripQuoted('Yes. On 12 Sep 2026 at 09:00, A <a@x.com> wrote: older stuff')).toBe('Yes.')
  })

  it('CONTROL: an ordinary sentence containing the word wrote is not a cut', () => {
    /*
      The risk of un-anchoring. The window is six to a hundred and forty
      characters between a capital "On" and "wrote:", which this does not
      satisfy — and a rule that cut here would lose what somebody wrote, which
      is the direction this module errs away from.
    */
    const plain = 'She wrote: the numbers are fine. On balance I agree.'
    expect(stripQuoted(plain)).toBe(plain)
  })

  it('CONTROL: an HTML letter with no quoting survives whole', () => {
    expect(textFromHtml('<p>One.</p><p>Two.</p><p>Three.</p>')).toBe('One.\nTwo.\nThree.')
  })
})

describe('the attribution wraps, which the second live run refuted', () => {
  it('cuts when the address ends one line and "wrote:" begins the next', () => {
    /*
      The exact shape in Grant's inbox, and the reason `.` was wrong twice:
      it does not match a newline, so a wrapped attribution was invisible to a
      matcher that had already been loosened once.
    */
    const text = stripQuoted(
      'Confirmed for the 24th.\n\nOn Fri, 12 Sep 2026 at 09:00, Furkan O <furkan@example.com>\nwrote:\n> which day suits?',
    )
    expect(text).toBe('Confirmed for the 24th.')
  })

  it('takes the SHORTEST span, so a later "wrote:" does not widen the cut', () => {
    const text = stripQuoted(
      'Keep.\n\nOn 1 Jan 2026, A <a@x.com>\nwrote:\nolder\nshe wrote: older still',
    )
    expect(text).toBe('Keep.')
  })

  it('CONTROL: prose with no attribution in reach is kept', () => {
    // The lazy span still has a 6-140 ceiling, so an "On" and a "wrote:" far
    // apart in ordinary prose are not read as a quote header.
    const plain = `On Monday the board met. ${'Discussion continued at length. '.repeat(8)}Later she wrote: fine.`
    expect(stripQuoted(plain)).toBe(plain)
  })
})
