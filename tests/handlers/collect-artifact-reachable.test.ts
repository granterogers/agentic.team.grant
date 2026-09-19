/**
 * The audio Grant asked for can actually be started (#66).
 *
 * `notebook.collect_artifact` fetches a generated artifact out of NotebookLM,
 * stores it against the dashboard project and sends it as playable audio. It
 * has done all of that correctly since 11 September — and for eight days
 * **nothing enqueued it**. The only three jobs of that kind in the entire
 * history were put there by hand on the day it was written, to prove it end to
 * end, after which the issue was treated as finished.
 *
 * So the live chain was: Grant asks for an audio overview -> `notebook.generate`
 * starts it -> `notebook.collect` polls until it is ready -> **a link**. The
 * link is precisely the outcome he said he did not want:
 *
 *     "Claire could generate the audio, maybe bring that audio file into the
 *      dashboard project, and just directly have the audio file sent to me on
 *      Telegram that I can play it directly in Telegram rather than
 *      necessarily having to open notebook."
 *
 * Found by `npm run check:reachable`, which asks of every registered job kind
 * what a person could do to start it.
 *
 * ## Why this is a source test and not a driven one
 *
 * Driving `notebook.collect` to its ready branch needs a double for the vault,
 * the notebook API, the artifacts table and the claim race. `notion-import`'s
 * test already states the rule this repository works to — *"a test whose
 * double is wrong proves nothing"* — and a four-part double for a one-line
 * hand-off is more likely to be wrong than the hand-off is.
 *
 * `provenance-order.test.ts` set the precedent: when the property is
 * structural, assert the structure and say so.
 *
 * ## The second assertion is the one that will earn its keep
 *
 * A hand-off that exists but sends the wrong keys fails at RUNTIME, politely,
 * with *"I need a notebook, an artifact and a dashboard project to collect
 * into"* — an announce-false path, so Grant would hear nothing and the job
 * would read as complete. That is the quieter version of the same defect, and
 * it is exactly the disagreement CLAUDE.md keeps recording: two halves each
 * correct alone, only their pairing wrong. So the keys SENT are compared
 * against the keys READ, out of the two files, rather than either being
 * written down here where it could rot.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const poller = readFileSync('src/handlers/notebook.ts', 'utf8')
const collector = readFileSync('src/handlers/collect.ts', 'utf8')

/** The `enqueue_child(...)` call that hands off, with its payload. */
const handoff = (): string | null => {
  const at = poller.indexOf("'notebook.collect_artifact'")
  if (at === -1) return null
  /*
    Backwards as well as forwards.

    The first draft sliced only forwards from the kind and then asserted the
    call was an `enqueue_child` — which sits on the line ABOVE it in the SQL,
    so a correct hand-off failed its own test. Validate the instrument before
    believing what it says about the product; this one said the wrong thing on
    its first run.
  */
  return poller.slice(Math.max(0, at - 300), at + 600)
}

describe('#66 — the generated file reaches Grant, not just a link to it', () => {
  it('the poller hands off to the collector when the artifact is ready', () => {
    expect(handoff()).not.toBeNull()
  })

  it('the hand-off is enqueued as a job rather than called inline', () => {
    // Inline would mean fetching megabytes inside a five-minute lease that is
    // already most of the way through a poll, which is how a handler becomes a
    // stalled job. The file's own comment gives that reason for the poll chain.
    expect(handoff() ?? '').toMatch(/enqueue_child/)
  })

  it('only when the artifact has a file of its own', () => {
    /*
      A mind map is finished, interactive, and has no url — the poller already
      measures that as `direct`, and asking Google to download one would fail
      for a reason that is not a fault. Asserted as the guard being present
      immediately before the call rather than by driving both kinds.
    */
    const at = poller.indexOf("'notebook.collect_artifact'")
    const before = poller.slice(Math.max(0, at - 400), at)
    expect(before).toMatch(/if \(direct\) \{/)
  })

  it('sends every key the collector reads, and no key it ignores', () => {
    const sent = new Set(
      [...(handoff() ?? '').matchAll(/'([a-z_]+)',\s*(?:\$\{lit|lit\()/g)].map((m) => m[1]),
    )
    // What the collector's Payload interface actually declares.
    const iface = collector.slice(
      collector.indexOf('interface Payload'),
      collector.indexOf('}', collector.indexOf('interface Payload')),
    )
    const read = new Set([...iface.matchAll(/readonly ([a-z_]+)\?:/g)].map((m) => m[1]))

    expect(read.size).toBeGreaterThan(0)
    for (const key of read) expect(sent, `the poller must send ${key}`).toContain(key)
    for (const key of sent) expect(read, `the collector ignores ${key}`).toContain(key)
  })

  it('CONTROL: the key comparison can actually fail', () => {
    // A renamed key is the realistic regression, and it must not pass merely
    // because both sides were read from the same file.
    const read = new Set(['notebook_id', 'artifact_id', 'project_id', 'title'])
    const sent = new Set(['notebook_id', 'artifact_id', 'project_id', 'titel'])
    const missing = [...read].filter((k) => !sent.has(k))
    expect(missing).toEqual(['title'])
  })
})
