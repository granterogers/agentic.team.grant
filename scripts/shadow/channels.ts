/**
 * Channel-shape coverage — §16.
 *
 *   npm run shadow:channels
 *
 * The brief notes that canonical-door tests are *"one translation step short
 * of Telegram/Slack"*, and asks for that step to be covered safely, without
 * sending synthetic traffic anywhere real.
 *
 * So every generated message is put through the REAL Telegram adapter's
 * translation function and the invariant checked is the master spec's §5:
 *
 *   > Channel adapters may only translate. An adapter that decides is a bug.
 *
 * ## Nothing here talks to Telegram
 *
 * `toCanonicalCommand` is pure - no network, no database, no token. It takes
 * the JSON Telegram would POST and returns the row that would be written to
 * `public.inbound_commands`. Building that JSON locally and calling the
 * function is the whole of this check, which is why it is safe to run
 * anywhere and costs nothing.
 *
 * What it therefore does NOT prove: that Telegram's webhook is reachable,
 * that the signature check works, or that a reply arrives. Those need the
 * live door and a real chat, and pretending otherwise would be the
 * "verification that looks somewhere other than where the user looks"
 * CLAUDE.md records passing for the wrong reason three times in one day.
 */

import { type TelegramUpdate, toCanonicalCommand } from '../../src/channels/telegram.ts'
import { generateCorpus } from '../../src/simulation/compose.ts'
import { DEFAULT_WORLD } from '../../src/simulation/world.ts'

/**
 * A fixture chat and a fixture user.
 *
 * Numeric because Telegram ids are numeric, which CLAUDE.md records as the
 * reason a harness could not give itself a fixture-shaped name and
 * twenty-seven real jobs accumulated. Nothing here reaches
 * `enqueue_inbound`, so no job is created either way - but the numbers are
 * kept unmistakable so that if this ever does drive the live door, the rows
 * it makes are identifiable.
 */
const CHAT = -4242424242
const USER = 4242424242
let messageId = 0

const asTyped = (text: string): TelegramUpdate => ({
  update_id: ++messageId,
  message: {
    message_id: messageId,
    chat: { id: CHAT, type: 'private' },
    from: { id: USER, is_bot: false, username: 'shadow_grant_fixture' },
    date: Math.floor(Date.now() / 1000),
    text,
  },
})

/** A voice note, which carries no words at all until it is transcribed. */
const asVoice = (seconds: number): TelegramUpdate => ({
  update_id: ++messageId,
  message: {
    message_id: messageId,
    chat: { id: CHAT, type: 'private' },
    from: { id: USER, is_bot: false, username: 'shadow_grant_fixture' },
    date: Math.floor(Date.now() / 1000),
    voice: { file_id: `fixture-voice-${messageId}`, duration: seconds },
  },
})

const corpus = generateCorpus(DEFAULT_WORLD, 1, 2)

console.log('\nChannel shape - the translation step, run locally\n')
console.log('  Nothing below touches Telegram. `toCanonicalCommand` is pure: it takes')
console.log('  the JSON Telegram would POST and returns the row that would be written.\n')

let checked = 0
const altered: string[] = []
const lost: string[] = []

for (const scenario of corpus) {
  for (const turn of scenario.turns) {
    checked++
    let row: ReturnType<typeof toCanonicalCommand>
    try {
      row = toCanonicalCommand(asTyped(turn.say))
    } catch (e) {
      lost.push(`${scenario.id}: refused - ${(e as Error).message}`)
      continue
    }
    // The invariant. Not "roughly the same", not "after trimming": the
    // adapter may reformat nothing, because the office's comprehension layer
    // is entitled to see exactly what the person typed. A message
    // lower-cased or stripped of its filler here would be a decision, and
    // the decision belongs downstream.
    if (row.instruction !== turn.say) {
      altered.push(`${scenario.id}\n      sent:    ${turn.say}\n      arrived: ${row.instruction}`)
    }
  }
}

console.log(`  ${checked} generated messages through the Telegram adapter`)
console.log(`  ${altered.length} arrived different from how they were sent`)
console.log(`  ${lost.length} were refused outright\n`)

for (const a of altered.slice(0, 5)) console.log(`    ALTERED ${a}`)
for (const l of lost.slice(0, 5)) console.log(`    REFUSED ${l}`)

/*
  The control.

  A check whose happy path is "found nothing" needs something that must come
  back positive, or it is indistinguishable from a check that cannot report
  anything - CLAUDE.md's found-nothing trap, recorded three times. So: feed
  the adapter something it MUST refuse, and something it must translate to
  empty.
*/
console.log('  CONTROLS - these must behave as stated, or the check above proves nothing\n')

let controls = 0
let controlsOk = 0

controls++
try {
  toCanonicalCommand(asTyped('   '))
  console.log('    FAIL  an empty message was accepted')
} catch {
  controlsOk++
  console.log('    ok    an empty message is refused rather than enqueued as nothing')
}

controls++
const voice = toCanonicalCommand(asVoice(11))
if (voice.instruction === '' && voice.voice_file_id !== null && voice.voice_seconds === 11) {
  controlsOk++
  console.log('    ok    a voice note carries no words and no invented placeholder')
} else {
  console.log(`    FAIL  a voice note arrived as ${JSON.stringify(voice.instruction)}`)
}

controls++
const a = toCanonicalCommand(asTyped('same words'))
const b = toCanonicalCommand(asTyped('same words'))
if (a.dedupe_key !== b.dedupe_key) {
  controlsOk++
  console.log('    ok    two separate messages get separate dedupe keys')
} else {
  console.log('    FAIL  two separate messages share a dedupe key - one would be dropped')
}

controls++
const withBot = toCanonicalCommand(asTyped('hello'), new Date(), 'emma')
const withoutBot = toCanonicalCommand(asTyped('hello'), new Date(), 'tom')
if (!withBot.dedupe_key.includes('emma') || !withoutBot.dedupe_key.includes('tom')) {
  console.log('    FAIL  the dedupe key does not name the bot')
} else {
  controlsOk++
  console.log('    ok    the dedupe key names the bot, so two bots cannot collide')
}

console.log(`\n  ${controlsOk}/${controls} controls behaved as stated\n`)

const clean = altered.length === 0 && lost.length === 0 && controlsOk === controls
console.log(
  clean
    ? '  The adapter translates and does not decide, across the whole generated corpus.\n'
    : '  Something above needs reading.\n',
)

console.log('  NOT covered here, and needing the live door:')
console.log('    the webhook being reachable, the signature check, a reply arriving,')
console.log('    and the transcription a voice note is waiting for.\n')
