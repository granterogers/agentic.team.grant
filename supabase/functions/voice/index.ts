/**
 * Talk to Team — the voice surface's only endpoint.
 *
 * §22's scenario A ends in a conversation: *"Grant opens Team HQ on iPhone,
 * presses Talk to Team, asks 'what was Research going on about?' → Chief of
 * Staff explains from real state → 'bring Finance in' → Finance responds → 'do
 * what you think is best and let me know' → work continues autonomously."*
 * §22 B adds that the same instruction spoken must take the same canonical path
 * as the same instruction typed. Grant, asked which way §12's "optional
 * premium" and §22's completion criterion fall: **"Voice is required."**
 *
 * ## What this function is allowed to do
 *
 * §5: *"Channel adapters may only translate. They may never decide."* So this
 * endpoint does exactly three things, and none of them is a decision:
 *
 *   1. writes what was heard into `inbound_commands` as `origin_channel =
 *      'voice'` — the same table Slack and Telegram write to, with the same
 *      dedupe index;
 *   2. asks `app.voice_answer` — which lives in the canonical layer — whether
 *      this is answerable from real state;
 *   3. if it is not, calls `enqueue_inbound`, which is the identical call the
 *      Telegram webhook makes.
 *
 * There is no model here and there is no state loading here. The temptation
 * was considerable: speech wants a reply in two seconds and a job takes
 * minutes, so "just load some context and call a model" is one obvious step
 * away. That step would be a second implementation of routing, retrieval and
 * the quality gate, and the first of the two to drift would be the one nobody
 * was watching.
 *
 * ## What Grant hears when it is work
 *
 * The truth: that it has been put to the team, and where the answer will
 * appear. A voice surface that invented an answer rather than admitting the
 * work takes minutes would be worse than one that stayed silent, because it
 * would be believed.
 *
 * ## Why the browser does the listening
 *
 * §12 describes server-minted ephemeral credentials and WebRTC, which is the
 * OpenAI Realtime shape, and `voice-token` already mints those. It also costs
 * per minute against an account Grant has parked. The browser's own speech
 * recognition costs nothing, runs on the device, and reaches this same
 * endpoint — so the canonical layer is identical either way and the transport
 * is a swap rather than a rewrite. `known-unverified` item 1 is exactly this
 * question, and this is the answer to it.
 */

const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
/** One human, for V1 — the same subject Slack and Telegram attribute to. */
const SUBJECT = Deno.env.get('VOICE_SUBJECT') ?? 'grant'

const tokenMatches = async (presented: string | null): Promise<boolean> => {
  if (HQ_TOKEN === '' || presented === null || presented === '') return false
  const digest = async (v: string): Promise<Uint8Array> =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)))
  const [a, b] = await Promise.all([digest(presented), digest(HQ_TOKEN)])
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Same reasoning as hq-api: cross-origin by construction, and the bearer
      // token is the whole of the authorisation — never a cookie, so there is
      // no ambient credential for another origin to ride on.
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'cache-control': 'no-store',
    },
  })

const rpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const response = await fetch(`${DB_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  })
  return await response.json()
}

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return json({ ok: true })

  const url = new URL(request.url)
  if (request.method === 'GET' && url.pathname.endsWith('/health')) {
    return json({ ok: true, endpoint: 'voice', token_configured: HQ_TOKEN !== '' })
  }

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!(await tokenMatches(presented))) return json({ error: 'unauthorized' }, 401)

  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  /*
    Looking something up, as opposed to asking for it to be done.

    Grant: *"the voice doesn't seem to have access to any of the project
    data.. this is critical."* He was right, and the cause was that this
    endpoint had exactly one behaviour — record the utterance and either match
    it against `voice_answer`'s pattern list or delegate it. On a call, asking
    what is going on with a project got "I have put that to the team, the
    answer appears in Slack", about a fact one select away.

    This is a READ and nothing else. It writes no command, starts no job and
    makes no decision, so §5's rule that adapters may only translate is intact:
    `app.voice_lookup` is canonical-layer state and this hands it over. The
    write path below is untouched.

    Deliberately not recorded in `inbound_commands`. A question Claire asks on
    Grant's behalf mid-sentence is not an instruction from Grant, and logging
    it as one would put words in his mouth in the table the whole office reads.
  */
  if (url.pathname.endsWith('/look')) {
    const asked = (await request.json().catch(() => ({}))) as { about?: unknown }
    const about = typeof asked.about === 'string' ? asked.about.trim() : ''
    const found = await rpc('voice_lookup', { p_about: about })
    return json({ found })
  }

  /*
    A VOICE NOTE: audio in, words out, and nothing else.

    Grant, 23 September: *"press microphone, record a voice message, stop, send
    or cancel, audio is transcribed, transcription becomes part of the normal
    project conversation, agents can understand/respond to it exactly as if
    Grant had typed the message."*

    WHY THIS ENDPOINT RETURNS TEXT AND STOPS THERE. The same brief says: *"Do
    not create a separate voice note conversation."* The studio's ordinary chat
    already posts to `/turn` on this very function, so the shortest route to
    "exactly as if he had typed it" is to hand the page the words and let it
    take the path a typed message takes. Anything more here would be a second
    conversational system, and the two would drift.

    WHY THE TRANSCRIPTION HAPPENS HERE rather than in the browser.
    `dictate.js` (#196) uses the browser's own recogniser, which produces text
    and keeps no audio - right for dictating into a composer, wrong for a voice
    message, where the recording is the thing. This uses the service the office
    already has configured for Telegram voice notes, so there is one speech
    service, one key, and one place it is configured.

    The configuration is read PER CALL from `public.voice_transcriber()`, not
    from this function's environment, so rotating the key does not need a
    deploy of this function.

    The request shape below duplicates `transcribeOverApi` in
    `src/voice/inbound.ts`, because an edge function is a single file and
    cannot import it. `tests/voice/note-endpoint.test.ts` reads both and
    asserts they send the same fields to the same path, so the copy cannot
    drift quietly.
  */
  if (url.pathname.endsWith('/note')) {
    const heardForm = await request.formData().catch(() => null)
    const audio = heardForm?.get('audio')
    if (!(audio instanceof File)) return json({ error: 'no audio was sent' }, 400)
    if (audio.size < 1024) return json({ error: 'that recording was too short to hear' }, 400)
    /* 25 MB is the speech service's own ceiling; refusing here is a sentence
       rather than a rejection the page has to interpret. */
    if (audio.size > 25 * 1024 * 1024) {
      return json({ error: 'that recording is too long to transcribe' }, 413)
    }

    const conf = (await rpc('voice_transcriber', {})) as {
      mode?: string
      base_url?: string
      model?: string
      key?: string
    } | null
    const mode = conf?.mode ?? 'none'
    const baseUrl = conf?.base_url ?? ''
    const model = conf?.model ?? ''
    const key = conf?.key ?? ''
    if (mode !== 'api' || baseUrl === '' || model === '' || key === '') {
      /* Named, never printed: the reason says WHICH part is missing and no
         part of it is the credential. */
      return json({ error: 'the office has no speech service configured' }, 503)
    }

    const speech = new FormData()
    /*
      The name matters, not the bytes. The service accepts
      [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm] BY EXTENSION, and a
      browser recording arrives as webm or mp4 depending on the browser - so
      the extension is taken from the type the recorder actually used rather
      than assumed. `src/voice/inbound.ts` learned this the expensive way with
      Telegram's `.oga`.
    */
    const kind = String(audio.type || 'audio/webm').split(';')[0] ?? 'audio/webm'
    const ext =
      kind.includes('mp4') || kind.includes('m4a')
        ? 'mp4'
        : kind.includes('ogg') || kind.includes('opus')
          ? 'ogg'
          : kind.includes('wav')
            ? 'wav'
            : 'webm'
    speech.append('file', new File([await audio.arrayBuffer()], `note.${ext}`, { type: kind }))
    speech.append('model', model)
    speech.append('response_format', 'json')
    speech.append('language', 'en')
    /*
      A spelling hint, and only that. The page sends the project's name and the
      team's names because "NotebookLM" is not a word a general speech model
      expects. It biases spelling; it decides nothing, so §5 is intact.
    */
    const said = heardForm?.get('vocabulary')
    const hint = typeof said === 'string' ? said.slice(0, 400) : ''
    if (hint !== '') speech.append('prompt', hint)

    const heardBack = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: speech,
    }).catch(() => null)
    if (heardBack === null) return json({ error: 'the speech service could not be reached' }, 502)
    const heardJson = (await heardBack.json().catch(() => ({}))) as {
      text?: string
      error?: { message?: string }
    }
    if (!heardBack.ok || heardJson.error !== undefined) {
      return json(
        {
          error:
            `the speech service refused (${String(heardBack.status)}): ` +
            String(heardJson.error?.message ?? 'no reason given').slice(0, 200),
        },
        502,
      )
    }
    const words = String(heardJson.text ?? '').trim()
    if (words === '') return json({ error: 'nothing could be made out in that recording' }, 422)
    return json({ heard: words })
  }

  const body = (await request.json().catch(() => ({}))) as {
    said?: unknown
    also?: unknown
    session?: unknown
    to?: unknown
  }
  const said = typeof body.said === 'string' ? body.said.trim() : ''
  const session = typeof body.session === 'string' ? body.session : ''
  if (said === '') return json({ error: 'nothing was said' }, 400)
  // A session id groups the turns of one conversation. Shaped, not trusted:
  // it goes into `origin_ref`, which `app.conversation_before` splits on ':'
  // to decide which turns belong together — so a session id containing a colon
  // would silently merge two conversations.
  /*
    Who it was addressed to (#26).

    Shaped, never resolved. §5 says an adapter may only TRANSLATE — so this
    records the slug it was given and lets `app.speaker` decide whether such a
    person exists and is active. An adapter that looked the roster up would be
    an adapter deciding, and it would be a second copy of a rule that already
    lives in one place.

    Anything that is not slug-shaped becomes nothing at all rather than being
    rerouted or refused: with no addressee the Chief of Staff takes it, which
    is the correct outcome for "I could not tell who you meant" and is what
    every other channel already does.

    This is the same path Telegram uses — there the addressee comes from WHICH
    BOT was opened, and `speaker()` calls that "addressed directly, Grant
    opened this person's bot". Typing it in the studio is the same act.
  */
  const to = typeof body.to === 'string' ? body.to.trim() : ''
  const addressedTo = /^[a-z][a-z0-9-]{1,40}$/.test(to) ? to : null
  /*
    And who ELSE he picked (#26).

    The specification asks for one, selected, or the entire team. Naming
    nobody already IS "the entire team" — the roster reads the subject and
    convenes whoever knows about it — so this is the middle one, and it takes
    the same path: `addressed_to` answers and each of these answers in their
    own name.

    Shape-checked here and nowhere else translated. §5 says an adapter may
    only translate: it must not look anybody up, decide who is real, or drop
    somebody for a reason of its own. 0410's trigger removes an unknown or
    retired name, which is the office's job, and the studio shows what was
    dropped.

    Capped at seven, which is the roster minus the answerer — not as a policy
    but because a longer array is somebody sending a list, not a selection.
  */
  const alsoAddressed = Array.isArray(body.also)
    ? [
        ...new Set(
          body.also
            .filter((x): x is string => typeof x === 'string')
            .map((x) => x.trim())
            .filter((x) => /^[a-z][a-z0-9-]{1,40}$/.test(x) && x !== addressedTo),
        ),
      ].slice(0, 7)
    : []

  if (!/^[A-Za-z0-9_-]{6,64}$/.test(session)) {
    return json({ error: 'a session id is required' }, 400)
  }

  // 1. Canonicalise. `origin_ref` is `session:turn`, matching the
  //    `chat:message` shape every other channel uses, so conversation memory
  //    and the pairing window work here with no special case.
  const turn = Date.now().toString(36)
  const stored = await fetch(`${DB_URL}/rest/v1/inbound_commands`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=ignore-duplicates,return=representation',
    },
    body: JSON.stringify({
      origin_channel: 'voice',
      origin_ref: `${session}:${turn}`,
      actor: SUBJECT,
      // `subject` is NOT set here. 0056's trigger resolves it through
      // `app.subject_for`, the same way it does for Slack and Telegram — and a
      // channel that writes its own subject is a channel exempt from the
      // identity map. The exemption was invisible until `verify:cross-interface`
      // compared a voice row against a Slack one and found this the only column
      // that differed (0104).
      instruction: said,
      addressed_to: addressedTo,
      addressed_also: alsoAddressed,
      dedupe_key: `voice:turn:${session}.${turn}`,
    }),
  })
  /*
    An addressee that is not a person must not cost Grant his message.

    `inbound_commands.addressed_to` carries a FOREIGN KEY to `staff`, so a slug
    that names nobody does not route badly — it fails the INSERT, and the whole
    turn comes back as "could not record what you said". The thing he typed is
    gone, because of who he addressed it to.

    So: one retry with no addressee. Not a roster lookup — §5 says an adapter
    may only translate, and asking `staff` who exists would put a routing rule
    in a second place. This says "I could not translate that name into a
    person, so I recorded no addressee", which is exactly translation failing
    honestly, and the Chief of Staff then takes it as she does for every
    unaddressed message.

    Only on 409-or-worse WITH an addressee set: an insert that failed for any
    other reason must still fail, or this quietly swallows real breakage.
  */
  let attempt = stored
  if (!attempt.ok && attempt.status !== 409 && addressedTo !== null) {
    attempt = await fetch(`${DB_URL}/rest/v1/inbound_commands`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify({
        origin_channel: 'voice',
        origin_ref: `${session}:${turn}`,
        actor: SUBJECT,
        instruction: said,
        addressed_to: null,
        // The selection goes too. The retry exists because a NAME could not be
        // translated, and 0410's trigger already drops the ones that are not
        // real — so keeping the rest is the difference between "I could not
        // find one of them" and "I ignored everybody you picked".
        addressed_also: alsoAddressed,
        dedupe_key: `voice:turn:${session}.${turn}`,
      }),
    })
  }
  if (!attempt.ok && attempt.status !== 409) {
    return json({ error: 'could not record what you said' }, 503)
  }
  const rows = (await attempt.json().catch(() => [])) as { command_id?: string }[]
  const commandId = rows[0]?.command_id
  if (commandId === undefined) return json({ error: 'could not record what you said' }, 503)

  // 2. Ask the canonical layer whether this is answerable. The decision is
  //    there, not here.
  const answer = (await rpc('voice_answer', { p_command_id: commandId })) as {
    speak?: string
    kind?: string
  } | null

  if (answer !== null && typeof answer.speak === 'string') {
    return json({ speak: answer.speak, did: 'answered', command_id: commandId })
  }

  // 3. Work. The same call the Telegram webhook makes, on the same table, so
  //    §31's equality is not a claim about two code paths that resemble each
  //    other — it is one code path reached from a third place.
  const queued = (await rpc('enqueue_inbound', { p_command_id: commandId })) as {
    job_id?: string
    error?: string
  }

  if (queued.job_id === undefined) {
    return json({
      speak:
        `I could not start that: ${String(queued.error ?? 'the queue refused it')}. ` +
        'Nothing has been lost — what you said is recorded.',
      did: 'refused',
      command_id: commandId,
    })
  }

  return json({
    speak:
      'Right — I have put that to the team. It takes a few minutes, and the answer ' +
      'appears in Slack. If it turns out to be important you will get a Telegram ' +
      'as well.',
    did: 'delegated',
    job_id: queued.job_id,
    command_id: commandId,
  })
})
