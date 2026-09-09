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

/**
 * Which pages may mint a credential.
 *
 * ## The bug this replaces
 *
 * Grant: *"talk to the team does not work 'failed to fetch' in either desktop
 * or mobile."*
 *
 * `VOICE_ALLOWED_ORIGIN` held ONE origin, and it held the wrong one: the URL of
 * the voice proof-of-concept's Vercel deployment, set by hand the day CORS was
 * tightened. The HQ page has lived at `ai-team-hq.vercel.app` since. So every
 * preflight from the real page was answered with an origin that was not the
 * real page's, the browser refused the response before any JavaScript saw it,
 * and `fetch` threw `TypeError: Failed to fetch` — which is what a browser says
 * for a CORS refusal and is indistinguishable, from the page, from being
 * offline.
 *
 * Nothing in the repository set that variable, so nothing could notice it had
 * gone stale. `scripts/deploy/voice.ts` now sets it on every deploy and
 * `scripts/verify/voice.ts` probes a preflight from the real page origin, so
 * the next time this rots it is a failing check rather than a phone button that
 * does nothing.
 *
 * ## A list, echoed, rather than one value
 *
 * A browser accepts exactly one origin in the header, so serving several means
 * echoing back whichever one asked — hence the allowlist and the `Vary`. The
 * allowlist matters because this endpoint takes no authentication: origin is
 * the only thing standing between a stranger's page and a credential minted
 * against Grant's OpenAI key.
 */
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

const ALLOWED_ORIGINS = (Deno.env.get('VOICE_ALLOWED_ORIGIN') ?? '*')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o !== '')

const corsFor = (request: Request): Record<string, string> => {
  const asked = request.headers.get('origin') ?? ''
  const allowed = ALLOWED_ORIGINS.includes('*')
    ? asked === ''
      ? '*'
      : asked
    : ALLOWED_ORIGINS.includes(asked)
      ? asked
      : // No match: answer with the first configured origin. The browser will
        // refuse it, which is the intended outcome — but the response is a
        // well-formed refusal rather than a header the caller can misread.
        (ALLOWED_ORIGINS[0] ?? 'null')
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    // Without this a shared cache can hand one origin's response to another.
    Vary: 'Origin',
  }
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
  'You have TWO tools and they are for different things.\n\n' +
  'look_up — to FIND OUT. A project, a colleague, what is in flight, what is ' +
  'waiting on him, what someone reported. It comes back in a second or two ' +
  'with real state, so use it freely rather than guessing or apologising. ' +
  'You may call it mid-sentence; keep talking while it runs.\n\n' +
  'ask_the_team — to MAKE SOMETHING HAPPEN. Research, analysis, a draft, a ' +
  'decision to be looked into, a change to be made. This starts real work and ' +
  'takes minutes, so say what you are doing in a few words BEFORE you call it ' +
  '("Right, I will put that to Emma"), then tell him what came back.\n\n' +
  'The difference matters: looking something up and telling him is instant, ' +
  'and putting it to the team is not. Never delegate a question you can look ' +
  'up. Never pretend to answer something that is actually work.\n\n' +
  'Below is the state of play as of the moment this call started. It is real ' +
  'and it is yours — you are not a switchboard, you run this office and you ' +
  'know what is in it. Speak from it directly. If he asks about something not ' +
  'in it, or asks for detail, look it up rather than saying you do not know.' +
  '\n\nIf something fails, say so plainly and say what you will do about it. ' +
  'Never say "I hope this helps", "let me know if", or "as an AI".'

const TOOLS = [
  {
    type: 'function',
    name: 'look_up',
    description:
      'Find out something real, now. A project by any name Grant uses for it, ' +
      'a colleague and what they last reported, what is in flight, what is ' +
      'waiting on him. Returns canonical state in about a second. Use this ' +
      'for every question of fact — never delegate one.',
    parameters: {
      type: 'object',
      properties: {
        about: {
          type: 'string',
          description:
            'What to look up, in his words — a project name, a person, or the ' +
            'question itself. Leave it vague and you get the state of play, ' +
            'which is a fine answer to "what is going on".',
        },
      },
      required: ['about'],
      additionalProperties: false,
    },
  },
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
  const cors = corsFor(request)
  if (request.method === 'OPTIONS') return new Response(null, { headers: cors })

  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405, headers: cors })
  }
  if (OPENAI_KEY === '') {
    return Response.json({ error: 'voice is not configured' }, { status: 503, headers: cors })
  }

  /*
    What she knows before he speaks.

    Grant: *"the voice doesn't seem to have access to any of the project
    data.. this is critical … it should be the true voice of 'claire' fully
    aware of everything."*

    She had one tool that delegated, so asked what was going on she either
    recited a canned sentence or promised a Slack message about a fact one
    select away. Briefing the session with real state at mint time is the
    difference between a chief of staff and a switchboard: the answer to "what
    have we got on" is in her head when she picks up, at no round-trip cost.

    Failure here is not fatal. A call with a stale brief and working tools is
    far better than no call, so a failed read logs and continues rather than
    taking voice down — but it is NOT silent, because a Claire who has
    forgotten the office should say so rather than improvise.
  */
  let stateBrief = ''
  try {
    const read = await fetch(`${DB_URL}/rest/v1/rpc/voice_state`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    if (read.ok) {
      stateBrief = `\n\n--- THE STATE OF PLAY ---\n${JSON.stringify(await read.json())}`
    } else {
      console.error(`voice_state came back ${read.status}`)
    }
  } catch (error) {
    console.error(`voice_state unreachable: ${(error as Error).message}`)
  }
  const instructions =
    stateBrief === ''
      ? `${INSTRUCTIONS}\n\nYou could not read the office's state when this call ` +
        'started. Say so if he asks about anything current, and use look_up — that ' +
        'may still work.'
      : INSTRUCTIONS + stateBrief

  const session = {
    type: 'realtime',
    model: MODEL,
    instructions,
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
        // Grant: *"also stop talking doesnt work"*. Talking over her did not
        // cut her off, because nothing had asked the server to stop the
        // response when his speech starts — `interrupt_response` was left at
        // whatever the API's default happened to be. Stated explicitly, so it
        // is a decision rather than a default that can move under us.
        turn_detection: { type: 'semantic_vad', interrupt_response: true },
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
    minted = await mint({ session: { type: 'realtime', model: MODEL, instructions } })
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
