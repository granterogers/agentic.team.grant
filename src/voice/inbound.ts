/**
 * A voice note, understood.
 *
 * Grant: *"the Telegram bots need to be able to receive voice notes. So when I
 * send a voice note, it's automatically understood, transcribed or whatever. I
 * don't need to see the transcription, but the receiving bots need to obviously
 * be able to work on that."*
 *
 * Two requirements in that sentence and the second is the interesting one. The
 * transcript is not a deliverable, it is an INPUT — so nothing here echoes it
 * back. It goes into `inbound_commands.transcript` because Postgres is
 * canonical and a command whose text nobody can read afterwards is a command
 * that cannot be audited, and then it becomes the instruction. Grant sees the
 * answer, not the transcription.
 *
 * ## The audio does not leave our own compute
 *
 * The first design sent it to the inference provider. That route is measurably
 * closed: of the three audio-capable free models OpenRouter lists, two are
 * gated to their vendor's own agent harness (403) and the third is refused by
 * our `data_collection: 'deny'` (404). ADR-0009 bought that refusal
 * deliberately, and a voice note — Grant's actual voice — is the last thing to
 * make an exception for.
 *
 * So `scripts/voice/transcribe.py` runs faster-whisper on the same runner as
 * the worker. Nothing about the recording is sent anywhere, which is a better
 * privacy answer than the one we were trying to buy.
 *
 * ## Why a duration cap
 *
 * Ten minutes. Not a cost limit — this is free — but a runtime one: the worker
 * holds a five-minute lease, and an hour-long recording would lose it partway
 * through and be recovered as a stalled job, repeatedly. A refusal that says
 * "too long, send it in parts" is a working system; a job that dies quietly on
 * its fourth attempt is not.
 */

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/** Long enough for a dictated instruction, short enough to hold a lease. */
export const MAX_VOICE_SECONDS = 600

/** Whisper on CPU runs faster than real time; this is the margin, not the cost. */
const TRANSCRIBE_TIMEOUT_MS = 300_000

export class VoiceNoteError extends Error {
  constructor(readonly detail: string) {
    super(`could not transcribe the voice note: ${detail}`)
    this.name = 'VoiceNoteError'
  }
}

export interface Transcript {
  readonly text: string
  readonly seconds: number
  readonly language: string | null
  readonly model: string
}

/**
 * Fetch a Telegram file and transcribe it.
 *
 * The token is passed rather than resolved here so this module stays free of
 * the database, and so the caller is forced to answer "which bot?" — a voice
 * note to Ines is fetched with Ines's token, and there is no default.
 */
export async function transcribeTelegramVoice(
  token: string,
  fileId: string,
  options: { readonly seconds?: number } = {},
): Promise<Transcript> {
  const declared = options.seconds ?? 0
  if (declared > MAX_VOICE_SECONDS) {
    throw new VoiceNoteError(
      `it is ${String(Math.round(declared))} seconds long and the limit is ` +
        `${String(MAX_VOICE_SECONDS)}. Send it in parts.`,
    )
  }

  const meta = (await (
    await fetch(`https://api.telegram.org/bot${token}/getFile`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    })
  ).json()) as { ok?: boolean; description?: string; result?: { file_path?: string } }

  if (meta.ok !== true || meta.result?.file_path === undefined) {
    throw new VoiceNoteError(`Telegram would not give us the file: ${String(meta.description)}`)
  }

  const audio = await fetch(
    `https://api.telegram.org/file/bot${token}/${String(meta.result.file_path)}`,
  )
  if (!audio.ok) {
    throw new VoiceNoteError(`downloading the file returned ${String(audio.status)}`)
  }

  // A temp DIRECTORY, removed whole in the finally. Grant's voice is not left
  // on a runner's disk for the next job to find, and a partial write cannot
  // leave a stray file behind that the recursive remove misses.
  const dir = await mkdtemp(join(tmpdir(), 'voice-'))
  try {
    const name = String(meta.result.file_path).split('/').pop() ?? 'note.oga'
    const path = join(dir, name)
    await writeFile(path, Buffer.from(await audio.arrayBuffer()), { mode: 0o600 })

    let stdout: string
    try {
      const result = await run('python3', ['scripts/voice/transcribe.py', path], {
        maxBuffer: 8 * 1024 * 1024,
        timeout: TRANSCRIBE_TIMEOUT_MS,
      })
      stdout = result.stdout
    } catch (error) {
      const e = error as { stdout?: string; message?: string }
      const text = (e.stdout ?? '').trim()
      if (text !== '') {
        const parsed = JSON.parse(text.slice(text.indexOf('{'))) as { error?: string }
        throw new VoiceNoteError(String(parsed.error ?? text).slice(0, 300))
      }
      throw new VoiceNoteError((e.message ?? 'no output').slice(0, 300))
    }

    const parsed = JSON.parse(stdout.slice(stdout.indexOf('{'))) as {
      ok?: boolean
      text?: string
      seconds?: number
      language?: string | null
      model?: string
      error?: string
    }
    if (parsed.ok !== true) throw new VoiceNoteError(String(parsed.error ?? 'unknown failure'))

    const text = String(parsed.text ?? '').trim()
    if (text === '') {
      // Silence, or speech the model could not make out. Distinct from a
      // failure: nothing broke, there is simply nothing to act on, and telling
      // Grant "I could not hear that" is the right answer to both.
      throw new VoiceNoteError('there were no words in it that I could make out')
    }

    return {
      text,
      seconds: Number(parsed.seconds ?? declared),
      language: parsed.language ?? null,
      model: String(parsed.model ?? 'unknown'),
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
