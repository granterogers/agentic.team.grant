/**
 * Who a message was sent TO, as opposed to where the answer goes back.
 *
 * `inbound_commands.addressed_to` has always held one fact for two readers:
 *
 *   (A) the reply path, which joins `telegram_bots` on it so the answer leaves
 *       through the bot that was written to (`src/telegram/roster.ts`), and
 *       threads a conversation on it (`app.recent_exchange`);
 *   (B) `speaker()`, which reads any non-empty value as "he opened this
 *       person's bot: that person answers, nobody else is convened".
 *
 * Telegram's chief bot is registered with the slug `chief-of-staff`, so every
 * Telegram instruction was recorded as addressed to her and (B) took the
 * "addressed directly" branch: Telegram, his main interface, never delegated.
 * The chief is not a selection, she is the router: writing to her bot is
 * writing to the office, which is what the file header of the instruction
 * handler has always said.
 *
 * The stored column stays as it is, because (A) is correct and every row ever
 * written carries the chief's slug (changing the stored value would split a
 * thread that spans the change). Only (B) is separated, here, once, so the
 * decision and every consumer of the decision read the same definition.
 */

/** The router, and the slug of the bot a person writes to when he writes to the office. */
export const CHIEF_OF_STAFF = 'chief-of-staff'

export interface Addressing {
  /** `inbound_commands.addressed_to`, or the `addressed_to` a hand-off child carries. */
  readonly addressedTo: string | null | undefined
  /** The rest of a selection he made himself in the composer (#26). */
  readonly alsoAddressed?: readonly string[]
  /** A hand-off child (it carries `handed_off_by`): it answers as who it was given to and never hands on. */
  readonly handedOff?: boolean
}

/**
 * Was this DIRECTLY addressed to a specialist (or to a selection he made), so that the specialist answers in their own
 * name and nobody else is convened? False means the Chief of Staff routes it, and she may convene the team.
 *
 * - Nobody named: routed.
 * - A hand-off child: direct, always. It was given to somebody, and a chain must end at one by construction rather than
 *   by the depth cap, so even a child addressed to the chief never routes again.
 * - A specialist other than the chief: direct (he opened their bot).
 * - The chief alone: routed. The chief WITH others he picked is a selection of several people, so it stays direct.
 */
export function addressedDirectly(input: Addressing): boolean {
  const to = (input.addressedTo ?? '').trim()
  if (to === '') return false
  if (input.handedOff === true) return true
  if (to !== CHIEF_OF_STAFF) return true
  return (input.alsoAddressed ?? []).some((x) => x !== '' && x !== CHIEF_OF_STAFF)
}
