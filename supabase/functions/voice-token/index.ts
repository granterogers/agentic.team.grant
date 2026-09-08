/**
 * Mint an ephemeral Realtime credential, and decide what that session is.
 *
 * §12: *"The browser never receives the permanent API key: server-minted
 * ephemeral credentials."* This endpoint is the only place the permanent key is
 * used, and it never appears in a response.
 *
 * Verified against the live API 2026-09-03, per §13's requirement to re-check
 * model names immediately before Gate 1:
 *   - mint endpoint is `POST /v1/realtime/client_secrets` (anything citing
 *     `/v1/realtime/sessions` is stale)
 *   - returns `{ value: "ek_…", expires_at, session }`
 *   - `gpt-realtime-2.1` and `gpt-realtime-2.1-mini` both present
 *
 * The model is read from the environment, never hard-coded: §4 requires every
 * model identifier to be configuration, and the deprecated `gpt-realtime` and
 * `gpt-realtime-mini` are still listed by the API today while being removed on
 * 2027-01-20 — so a constant here would rot silently.
 *
 * ## Why the whole session is configured here and not in the page
 *
 * Grant: *"you need to fix the proper voice chat feature in the front end.. the
 * current solution sucks"*. It did, and the reason was not the transport: the
 * page was a proof of concept talking to a model that had been TOLD it was a
 * proof of concept with no access to anything. Talking to it was a demo of
 * latency.
 *
 * So the session now arrives knowing who it is and what it can do — it is
 * Claire, the Chief of Staff, and she can put work to the team through the
 * `ask_the_team` tool. The instructions and the tool list are minted here
 * rather than declared by the browser for the same reason the key is: a page
 * that can rewrite the assistant's instructions is a page that can rewrite the
 * assistant, and the page is the untrusted half of this pair.
 */
const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY') ?? ''
const MODEL = Deno.env.get('VOICE_MODEL') ?? 'gpt-realtime-2.1-mini'
// Claire is a woman and this is her voice. Configuration, not a constant, so
// Grant can change who he is talking to without a deploy.
const VOICE = Deno.env.get('VOICE_NAME') ?? 'marin'

const ALLOWED_ORIGIN = Deno.env.get('VOICE_ALLOWED_ORIGIN') ?? '*'

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/**
 * Who she is.
 *
 * Written as a brief to a person, not a system prompt, because the failure
 * mode of a voice assistant is not being wrong — it is being a call centre.
 * The rules about length exist because spoken text has no skim: a paragraph
 * that reads fine takes twenty seconds to sit through, and you cannot scroll
 * past it.
 */
const INSTRUCTIONS =
  "You are Claire, Chief of Staff of Grant's small AI team. You are on a " +
  'voice call with Grant himself — he runs the place, he knows how it works, ' +
  'and he is not a customer.\n\n' +
  'Talk like a competent colleague on the phone. Short turns: one or two ' +
  'sentences, then stop and let him speak. Never deliver a paragraph. Never ' +
  'list more than three things aloud. Contractions, plain words, an opinion ' +
  'where you have one. British English.\n\n' +
  'You have seven directors: Tom on strategy, Emma on research, Daniel on ' +
  'finance and data, Marcus on operations, Ruby on growth and marketing, ' +
  'Oliver on communications and creative, Grace on quality and risk.\n\n' +
  'When Grant asks for something that is real work — research, analysis, a ' +
  'draft, a decision to be looked into — use the ask_the_team tool. Say what ' +
  'you are doing in a few words BEFORE you call it ("Right, I will put that ' +
  'to Emma"), call it, then tell him what came back in one or two sentences. ' +
  'Use it for anything about the current state of his projects too: you do ' +
  'not know that from memory, the office does.\n\n' +
  'Do not use the tool for chit-chat, for clarifying what he means, or for ' +
  'anything you can answer in a sentence. Ask a clarifying question when the ' +
  'ask is genuinely ambiguous — once, not three times.\n\n' +
  'If something fails, say so plainly and say what you will do about it. ' +
  'Never say "I hope this helps", "let me know if", or "as an AI".'

const TOOLS = [
  {
    type: 'function',
    name: 'ask_the_team',
    description:
      'Put a request or a question to the team. Use for real work and for ' +
      "anything about the live state of Grant's projects. Returns what the " +
      'office says, which may be an answer or a confirmation that it has been ' +
      'delegated and will come back in Slack.',
    parameters: {
      type: 'object',
      properties: {
        said: {
          type: 'string',
          description:
            'What to put to the team, in full, as a self-contained sentence. ' +
            'The office cannot see the rest of this call, so resolve every ' +
            '"it" and "that" before sending.',
        },
      },
      required: ['said'],
      additionalProperties: false,
    },
  },
]

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405, headers: cors })
  }
  if (OPENAI_KEY === '') {
    return Response.json({ error: 'voice is not configured' }, { status: 503, headers: cors })
  }

  const session = {
    type: 'realtime',
    model: MODEL,
    instructions: INSTRUCTIONS,
    audio: {
      input: {
        // Grant, about the Telegram notes: he wants to see what was heard, so
        // a mishearing is something he corrects rather than something that
        // runs. The same argument holds louder on a call, where there is no
        // message to re-read.
        transcription: { model: 'whisper-1' },
        // Semantic turn detection ends his turn on meaning rather than on a
        // gap, which is the difference between being interrupted mid-thought
        // and being allowed to think.
        turn_detection: { type: 'semantic_vad' },
      },
      output: { voice: VOICE },
    },
    tools: TOOLS,
    tool_choice: 'auto',
  }

  const mint = async (body: unknown): Promise<Response> =>
    await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  let minted = await mint({ session })
  let degraded = false
  if (!minted.ok) {
    // The realtime session schema is young and has already moved once. A
    // rejected field must not take voice down entirely: fall back to the
    // shape that has always worked, and SAY that it is degraded rather than
    // quietly handing back a session with no tools and no transcript.
    console.error(
      `full session rejected: ${minted.status} ${(await minted.clone().text()).slice(0, 300)}`,
    )
    minted = await mint({ session: { type: 'realtime', model: MODEL, instructions: INSTRUCTIONS } })
    degraded = true
  }

  const payload = (await minted.json()) as {
    value?: string
    expires_at?: number
    session?: { model?: string }
    error?: { message?: string }
  }

  if (!minted.ok || payload.value === undefined) {
    // The upstream message can echo request detail, so it is not forwarded
    // verbatim — §15 keeps provider errors out of anything client-visible.
    console.error(`mint failed: ${minted.status} ${payload.error?.message ?? ''}`)
    return Response.json({ error: 'could not mint a session' }, { status: 502, headers: cors })
  }

  // Only the ephemeral secret leaves. It expires in ~60s by default and is
  // useless afterwards, which is the entire point of the indirection.
  return Response.json(
    {
      client_secret: payload.value,
      expires_at: payload.expires_at,
      model: payload.session?.model ?? MODEL,
      voice: VOICE,
      // The page shows this. A call where she cannot reach the team is worth
      // knowing about before you ask her to do something.
      tools: degraded ? [] : TOOLS.map((t) => t.name),
      degraded,
    },
    { headers: cors },
  )
})
