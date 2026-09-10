/**
 * A voice note, understood.
 *
 * Grant: *"the Telegram bots need to be able to receive voice notes. So when I
 * send a voice note, it's automatically understood, transcribed or whatever. I
 * don't need to see the transcription, but the receiving bots need to obviously
 * be able to work on that."*
 *
 * ## He has since reversed the "I don't need to see the transcription" part
 *
 * Grant: *"Whenever I send a voice note to an agent, I want to see the
 * transcription immediately so I can see what's actually been heard, and then
 * it can give me the interpretation. Because I just sent a voice note to one of
 * the agents and it doesn't seem to have understood what I've asked at all. So
 * I want to check if it's simply a transcription problem or if it's just too
 * stupid to understand what I'm saying."*
 *
 * He was right to suspect it, and the answer was transcription. He said "a new
 * NotebookLM project called Wellness Legacy course" and Whisper wrote **"a new
 * Not-to-But project"**. The Chief of Staff never saw the word that said what
 * the request was about, and answered a question nobody had asked.
 *
 * That is the whole argument for echoing it. A wrong answer with no visible
 * input is indistinguishable from a stupid colleague; the same wrong answer
 * with "Heard: …" above it is a one-second diagnosis. The transcript is still
 * an INPUT rather than a deliverable — it is echoed as evidence of what was
 * received, not offered as the work.
 *
 * It goes into `inbound_commands.transcript` because Postgres is canonical and
 * a command whose text nobody can read afterwards is a command that cannot be
 * audited, and then it becomes the instruction.
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
import type { SqlExecutor } from '../db/executor.ts'

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
  /** Whether a vocabulary hint reached the decoder. Diagnostic, not decorative. */
  readonly hinted: boolean
}

/**
 * Fetch a Telegram file and transcribe it.
 *
 * The token is passed rather than resolved here so this module stays free of
 * the database, and so the caller is forced to answer "which bot?" — a voice
 * note to Ines is fetched with Ines's token, and there is no default.
 */
/**
 * Where the words come from.
 *
 * Two routes, because the two places a pass runs can do different things. A
 * GitHub runner can spawn Python; the Supabase Edge Function cannot, and since
 * Grant switched Actions off the edge is the only place left — so the API
 * route is not a fallback, it is the main one.
 */
export interface Transcriber {
  readonly mode: 'none' | 'runner' | 'api'
  readonly baseUrl?: string
  readonly model?: string
  readonly key?: string
}

/**
 * Read the configured transcriber, mapping SQL's names to the code's.
 *
 * Exists because the first version did not: `app.voice_transcriber()` returns
 * `base_url` and the interface says `baseUrl`, so the cast compiled, the field
 * was silently undefined, and every transcription failed with "the speech
 * service is not configured" while the service was configured perfectly well.
 *
 * A cast across a naming convention is not a type check, it is a wish. The
 * mapping is written out here, once, where both callers get it.
 */
export const readTranscriber = async (db: SqlExecutor): Promise<Transcriber> => {
  const raw = (await db.execute('select app.voice_transcriber() as j')).rows[0]?.j
  const row = (typeof raw === 'string' ? JSON.parse(raw) : (raw ?? {})) as {
    mode?: string
    base_url?: string
    model?: string
    key?: string
  }
  const mode = row.mode === 'api' || row.mode === 'runner' ? row.mode : 'none'
  return {
    mode,
    ...(row.base_url === undefined ? {} : { baseUrl: row.base_url }),
    ...(row.model === undefined ? {} : { model: row.model }),
    ...(row.key === undefined || row.key === null ? {} : { key: row.key }),
  }
}

/**
 * Transcribe over HTTP, OpenAI-shaped.
 *
 * `fetch` and nothing else, deliberately: this has to run inside Deno on the
 * edge, where there are no subprocesses and no filesystem worth the name.
 *
 * The vocabulary goes in as `prompt`, which is the same lever `initial_prompt`
 * was locally and for the same reason — "NotebookLM" is not a word any general
 * speech model expects, and it became "Not-to-But" without it.
 */
export async function transcribeOverApi(
  audio: Uint8Array,
  filename: string,
  transcriber: Transcriber,
  vocabulary: readonly string[] = [],
): Promise<Transcript> {
  const { baseUrl, model, key } = transcriber
  if (baseUrl === undefined || model === undefined || key === undefined || key === '') {
    throw new VoiceNoteError('the speech service is not configured')
  }

  const form = new FormData()
  // `.ogg`, not Telegram's `.oga`.
  //
  // A Telegram voice note is Ogg Opus and arrives named `.oga`, which is a
  // perfectly ordinary extension for it and is NOT on the list the speech
  // service accepts: "file must be one of [flac mp3 mp4 mpeg mpga m4a ogg opus
  // wav webm]". The bytes were always fine; only the name was wrong, which is
  // the kind of rejection that reads like a codec problem and is not one.
  const named = filename.replace(/\.oga$/i, '.ogg')
  form.append('file', new File([audio], named, { type: 'audio/ogg' }))
  form.append('model', model)
  form.append('response_format', 'json')
  // English, said out loud. Left to guess, a short note in accented English is
  // occasionally detected as something else and comes back translated.
  form.append('language', 'en')
  const hint = vocabulary.join(', ').slice(0, 400)
  if (hint !== '') form.append('prompt', hint)

  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  })
  const body = (await response.json().catch(() => ({}))) as {
    text?: string
    error?: { message?: string }
  }
  if (!response.ok || body.error !== undefined) {
    throw new VoiceNoteError(
      `the speech service refused (${String(response.status)}): ` +
        `${String(body.error?.message ?? 'no reason given')}`.slice(0, 240),
    )
  }
  const text = String(body.text ?? '').trim()
  if (text === '') throw new VoiceNoteError('there were no words in it that I could make out')

  return {
    text,
    // The API reports no duration, and inventing one would put a number in the
    // ledger that nothing measured.
    seconds: 0,
    language: 'en',
    model,
    hinted: hint !== '',
  }
}

/** Fetch the audio Telegram is holding. Shared by both routes. */
export async function fetchTelegramAudio(
  token: string,
  fileId: string,
): Promise<{ bytes: Uint8Array; filename: string }> {
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
  return {
    bytes: new Uint8Array(await audio.arrayBuffer()),
    filename: String(meta.result.file_path).split('/').pop() ?? 'note.oga',
  }
}

export async function transcribeTelegramVoice(
  token: string,
  fileId: string,
  options: { readonly seconds?: number; readonly vocabulary?: readonly string[] } = {},
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
    // `Uint8Array`, not `Buffer` — the third time this repository has been bitten
    // by the same thing, after `channels/telegram.ts` and `slack/signature.ts`,
    // both of which carry the note. `Buffer` is a Node global and not a Deno
    // one, this module is reached from `handlers/instruction.ts`, and that runs
    // in the Deno worker. Every unit test passed under Node while a real voice
    // note from Grant on 8 September failed with `Buffer is not defined`.
    // Line 227 of this very file already did it correctly.
    await writeFile(path, new Uint8Array(await audio.arrayBuffer()), { mode: 0o600 })

    let stdout: string
    try {
      // The vocabulary is passed as one argument, capped, because it becomes
      // Whisper's `initial_prompt` and that has a real token budget — a list
      // long enough to fill it would push out the audio's own context and make
      // the transcript worse, not better.
      const hint = (options.vocabulary ?? []).join(', ').slice(0, 400)
      const result = await run('python3', ['scripts/voice/transcribe.py', path, hint], {
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
      hinted?: boolean
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
      hinted: parsed.hinted === true,
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
