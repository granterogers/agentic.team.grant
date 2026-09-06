/**
 * Voice notes, and the decision not to make one.
 *
 * Phase 7's acceptance for this feature is one sentence: *"TTS degrades to text
 * rather than incurring cost."* That sentence is the whole design, and it has
 * one consequence worth stating before any code: **there is no fallback path.**
 *
 * A fallback is a second path taken when the first fails, and second paths rot
 * — they run rarely, they are tested rarely, and the day they matter is the day
 * they are wrong. So the text is not the fallback here. The text is the
 * deliverable, always produced, always sent. Audio is an *addition* that
 * sometimes accompanies it. Nothing downstream has to know whether synthesis
 * happened, because nothing downstream reads a different field when it did not.
 *
 * ## Why a decision layer at all
 *
 * Chirp 3: HD is free to a million characters a month and priced after that. A
 * free tier with a ceiling is a budget, and §11's rule for budgets is that they
 * are counted locally — Google exposes no live counter, so the only figure this
 * system can have is the one it keeps (0038). Deciding in one place, against
 * that ledger, is what stops "we are probably fine" from being the policy.
 *
 * ## The rules, and why each one is not a preference
 *
 * Each of these refuses audio, and each refuses it for a reason that is about
 * correctness rather than taste:
 *
 * - **No credential** — nothing to call. Reported as its own reason rather than
 *   folded into a generic failure, because "not configured" and "it broke" need
 *   different people to do different things.
 * - **Over budget** — the ceiling exists to be respected, and the reservation
 *   is taken before synthesis, not after.
 * - **Too long** — a four-minute recital of a research finding is not a voice
 *   note. §12 calls Telegram the pager; a pager that talks for four minutes is
 *   a phone call nobody agreed to.
 * - **Unreviewed** (§16) — the printed message carries "not reviewed" where a
 *   reader can see it. Audio has no margin: the caveat has to be *spoken*, and
 *   if it were spoken it would be the first thing heard and the last thing
 *   remembered wrongly. Text only, and it is not close.
 * - **Contains a table, code or a list of figures** — speech makes these worse,
 *   not merely no better. A column of numbers read aloud is unusable, and it
 *   sounds authoritative while being unusable.
 */

import type { SqlExecutor } from '../db/executor.ts'

const lit = (v: string): string => `'${v.replace(/'/g, "''")}'`

/** Google's free allowance for Chirp 3: HD, per §2's technology table. */
export const CHIRP3_MONTHLY_FREE_CHARACTERS = 1_000_000

/**
 * How much of the monthly allowance voice notes may take.
 *
 * Not the whole of it. Something else will want TTS eventually — a briefing, a
 * probe — and a feature that can consume the entire budget alone will, on the
 * day it loops.
 */
export const VOICE_NOTE_CEILING = 400_000

/**
 * The longest thing worth speaking, in characters.
 *
 * Roughly ninety seconds at an ordinary reading pace. Chosen as a duration and
 * converted, rather than picked as a round number of characters, because the
 * limit is about the listener.
 */
export const MAX_SPOKEN_CHARACTERS = 1_200

export const TTS_PROVIDER = 'google.chirp3-hd'

export type SilentReason =
  | 'no_credential'
  | 'over_budget'
  | 'too_long'
  | 'unreviewed'
  | 'not_speakable'
  | 'caller_asked_for_text'

export interface VoiceNoteRequest {
  readonly text: string
  /** False for §10-substantive output that has not been reviewed. */
  readonly reviewed: boolean
  readonly correlationId?: string | null
  /** Set when Grant has asked for text on this channel. */
  readonly textOnly?: boolean
  readonly voice?: string | null
}

export interface VoiceNoteDecision {
  /** Always present. This is the deliverable, not the consolation prize. */
  readonly text: string
  readonly speak: boolean
  /** Null when speaking. Otherwise why not, in a word a human can act on. */
  readonly silentBecause: SilentReason | null
  /** The reservation, when one was taken. Needed to record a failure against. */
  readonly usageId: string | null
  readonly characters: number
}

/**
 * Content that speech makes worse.
 *
 * Deliberately crude and deliberately biased towards refusing: a false negative
 * costs a voice note nobody hears, and a false positive costs a column of
 * numbers read aloud as though it were a sentence.
 */
export function isSpeakable(text: string): boolean {
  if (text.includes('```')) return false
  // A markdown table, or anything laid out in columns.
  if (/^\s*\|.*\|\s*$/m.test(text)) return false
  // Three or more bullet or numbered lines: a list is a shape, and speech has
  // no shapes.
  const listLines = text.split('\n').filter((line) => /^\s*([-*•]|\d+[.)])\s/.test(line))
  if (listLines.length >= 3) return false
  // A paragraph that is mostly figures. Percentages, currency and bare numbers
  // separated by punctuation are a table wearing prose.
  const figures = text.match(/[£$€]?\d[\d,.]*%?/g) ?? []
  if (figures.length >= 8) return false
  return true
}

export interface DecideOptions {
  /** Whether a usable TTS credential exists. Passed in, never guessed at. */
  readonly credentialAvailable: boolean
  readonly ceiling?: number
  readonly maxCharacters?: number
}

/**
 * Decide whether this text should also be spoken, and reserve the budget if so.
 *
 * The order of the checks is the cheap ones first, and the reservation last —
 * a reservation taken and then refused for length would spend budget on a note
 * that was never going to be made.
 */
export async function decideVoiceNote(
  db: SqlExecutor,
  request: VoiceNoteRequest,
  options: DecideOptions,
): Promise<VoiceNoteDecision> {
  const characters = request.text.length
  const silent = (silentBecause: SilentReason): VoiceNoteDecision => ({
    text: request.text,
    speak: false,
    silentBecause,
    usageId: null,
    characters,
  })

  if (request.textOnly === true) return silent('caller_asked_for_text')
  if (!options.credentialAvailable) return silent('no_credential')
  if (!request.reviewed) return silent('unreviewed')
  if (characters > (options.maxCharacters ?? MAX_SPOKEN_CHARACTERS)) return silent('too_long')
  if (!isSpeakable(request.text)) return silent('not_speakable')

  const { rows } = await db.execute(`
    select app.reserve_tts_characters(
      ${lit(TTS_PROVIDER)}, ${String(characters)},
      ${String(options.ceiling ?? VOICE_NOTE_CEILING)},
      ${request.correlationId === null || request.correlationId === undefined ? 'null' : `${lit(request.correlationId)}::uuid`},
      'voice_note',
      ${request.voice === null || request.voice === undefined ? 'null' : lit(request.voice)}
    )::text as usage_id
  `)
  const usageId = (rows[0] as { usage_id?: string | null } | undefined)?.usage_id ?? null

  // Null means the reservation did not fit. Not an error: the budget doing its
  // job, and the text goes out exactly as it would have anyway.
  if (usageId === null) return silent('over_budget')

  return { text: request.text, speak: true, silentBecause: null, usageId, characters }
}

/**
 * Record that a reserved synthesis failed.
 *
 * The characters stay counted. We cannot tell from a failed call whether the
 * provider processed the text before failing, and a budget that under-counts
 * on error is a budget that is wrong in the expensive direction.
 */
export async function recordSynthesisFailure(
  db: SqlExecutor,
  usageId: string,
  errorCode: string,
): Promise<void> {
  await db.execute(
    `select app.record_tts_failure(${lit(usageId)}::uuid, ${lit(errorCode.slice(0, 200))}) as ok`,
  )
}

/** Characters spent this month, from our own ledger — there is no other. */
export async function charactersThisMonth(db: SqlExecutor): Promise<number> {
  const { rows } = await db.execute(
    `select app.tts_characters_this_month(${lit(TTS_PROVIDER)}) as n`,
  )
  return Number((rows[0] as { n?: number } | undefined)?.n ?? 0)
}
