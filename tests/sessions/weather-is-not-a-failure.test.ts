/**
 * A provider outage is not the office answering badly.
 *
 * `npm run session -- --report` scored 714/737 across 163 turns, and **nine of
 * its twenty-three failures were weather**: the entire `roster` session — all
 * seven specialist turns and both of its controls — failed on 15 September
 * inside one OpenRouter outage, every job carrying
 *
 *     handler threw: provider openrouter is unavailable: its circuit breaker
 *     is open
 *
 * and the report has read them as behavioural failures every run since. Four
 * days of weather in the failure column of the instrument that is supposed to
 * say whether the office thinks well.
 *
 * That is the shape CLAUDE.md records again and again and keeps paying for: a
 * measurement that cries wolf is one Grant learns to ignore. `office_health()`
 * already has a word for this state — `cannot_think` — and the harness did
 * not.
 *
 * ## Why this predicate needs a test more than most
 *
 * It decides what counts as a product failure. A classifier like that which
 * has only ever been shown strings it must MATCH is the found-nothing shape:
 * it reads as working whether it matches everything or nothing. CLAUDE.md:
 * *"Give any found-nothing check a control that must come back positive"* —
 * and here the control that matters is the negative one, because the
 * expensive direction is hiding a real failure rather than showing a false
 * one.
 *
 * So both halves are asserted, and the strings are the REAL ones, counted out
 * of every session job ever recorded rather than invented for the test:
 *
 *   37 x provider unavailable   -> weather, must not be scored
 *    9 x incoherent metadata    -> the office, must stay a failure
 *    2 x a provenance defect    -> the office, must stay a failure
 */
import { describe, expect, it } from 'vitest'
import { weather } from '../../scripts/sessions/run.ts'

/** Verbatim from `public.jobs.state_reason`, 37 rows. */
const OUTAGE = 'handler threw: provider openrouter is unavailable: its circuit breaker is open'

/** Verbatim, 9 rows. The coherence gate refusing — a behavioural outcome. */
const GATE = 'incoherent output metadata: body'

/** Verbatim, 2 rows. The provenance-order defect, since fixed. */
const PROVENANCE =
  'output refused: Failed to run sql query: output cannot be marked deterministic: ' +
  'job 5a6457f4-b3 has 1 recorded inference attempt(s) against correlation'

describe('a provider outage is weather, and everything else is the office', () => {
  it('recognises the outage that cost nine turns', () => {
    expect(weather(OUTAGE)).toBe(true)
  })

  it('recognises a provider being unavailable whatever the provider is called', () => {
    // The property is "a provider is unavailable", not "the word openrouter".
    // An enumeration of provider names would go stale the day a second one is
    // added, which is the correction this file records four times over.
    expect(weather('handler threw: provider anthropic is unavailable')).toBe(true)
    expect(weather('provider some-new-vendor is unavailable: its circuit breaker is open')).toBe(
      true,
    )
  })

  it('CONTROL: the coherence gate refusing is NOT weather', () => {
    /*
      The load-bearing assertion. The gate refusing means the office produced
      an answer it could not stand behind — the single most important thing
      this harness exists to catch. Classing it as weather would silence it,
      and nothing else in the suite would notice.
    */
    expect(weather(GATE)).toBe(false)
  })

  it('CONTROL: a provenance refusal is NOT weather', () => {
    expect(weather(PROVENANCE)).toBe(false)
  })

  it('CONTROL: an ordinary handler error is NOT weather', () => {
    expect(weather('handler threw: Cannot read properties of undefined (reading ‘to’)')).toBe(false)
    expect(weather('no handler registered for job kind office.nonsense')).toBe(false)
    expect(weather('')).toBe(false)
  })

  it('CONTROL: it does not match merely because a provider is NAMED', () => {
    // "provider openrouter returned 400 invalid_request" is the office asking
    // for something wrong, not the provider being down. A pattern keyed on the
    // word `provider` alone would swallow it.
    expect(weather('handler threw: provider openrouter returned 400 invalid_request')).toBe(false)
  })
})
