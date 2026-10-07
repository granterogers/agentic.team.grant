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

import { conversationHead } from '../../../src/auth/conversation-key.ts'
import { resolveSpeaker, type Speaker } from '../../../src/auth/speaker.ts'

const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
/*
  WHO IS SPEAKING (#385, 0614; #400). A turn here is an INSTRUCTION, and an instruction from
  a person is what turns outward work from "ask first" into "he asked for it", so the
  speaker is the verified credential's fact and never a constant:

    person  - a signed-in member speaks as THEIR OWN owner key. There is no configured subject:
              `VOICE_SUBJECT` defaulted to 'grant' and so attributed every member's voice to him
              (#400, E2). A member with no owner key is not a speaker at all;
    harness - a signed-in TEST member speaks as itself, which the harness predicate
              names on sight;
    service - the office key speaks only as a declared test speaker, and only for a
              session id that already carries a harness prefix. It cannot speak as
              anybody real: possession of a generic key is not a voice.

  THE VERIFIER IS SHARED, not copied. This file used to carry its own session check on the
  grounds that an edge function is uploaded as one file and so could not import one. The
  worker's deploy has bundled its import graph for some time, and `deploy:voice` now does too:
  `voice-token` had NO check at all while this one had a private copy. Both ask
  `src/auth/speaker.ts`: Supabase, whether it issued this session, and `office_members`,
  whether the address is somebody the office works for. Neither decodes the JWT itself -- a
  token a function merely decoded is a token anybody can write. ADR-0043.
*/
const TEST_SESSION = /^(fixture|verify|probe|gate|ledger-proof)-/

const allowed = async (presented: string | null): Promise<Speaker | null> =>
  await resolveSpeaker(presented, {
    hqToken: HQ_TOKEN,
    supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
    anonKey: Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  })

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
  const speaker = await allowed(presented)
  if (speaker === null) return json({ error: 'unauthorized' }, 401)
  /*
    THE OFFICE THIS CALL BELONGS TO (P3): the signed-in speaker's login resolved to it, and the machine key (which names no
    office) is the test office's. Nothing the page sends can change it. A speaker with no office is refused, never defaulted.
  */
  let office: string | null = speaker.office
  if (office === null && speaker.kind === 'service') {
    const machine = (await rpc('resolve_machine_office', {}).catch(() => null)) as {
      ok?: boolean
      office_id?: string
    } | null
    office =
      machine?.ok === true && typeof machine.office_id === 'string' ? machine.office_id : null
  }
  if (office === null) return json({ error: 'no_office' }, 403)

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
    const found = await rpc('voice_lookup', { p_office: office, p_about: about })
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
    project?: unknown
  }
  const said = typeof body.said === 'string' ? body.said.trim() : ''
  const session = typeof body.session === 'string' ? body.session : ''
  if (said === '') return json({ error: 'nothing was said' }, 400)
  // A session id names one page VISIT. Shaped, not trusted: it goes into the
  // dedupe key (containment reads it) and, for a harness, into `origin_ref`,
  // which `app.conversation_before` splits on ':' - so a session id containing
  // a colon would silently merge two conversations. The conversation of a real
  // person is NOT the visit (H1): see `conversationHead`.
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
  // The office key is not a voice: it may speak only as a declared test speaker (#385).
  if (speaker.kind === 'service' && !TEST_SESSION.test(session)) {
    return json(
      {
        error: 'person_required',
        message:
          'A turn is somebody asking for something. It needs a signed-in person; the office key can only speak in a declared test session.',
      },
      403,
    )
  }

  /*
    THE PROJECT THE PAGE IS WRITING INTO (#373).

    The page names the thread's project by id, and this translates it into the
    two places the office already reads. It decides nothing.

    - `project_id` is 0337's column for "the project the caller named", which
      outranks every guess `app.enqueue_inbound` could make.
    - The conversation becomes that project's thread: `<head>/<project>`, the
      first segment of `origin_ref`, where the head is the person's durable
      one (H1) and, for a harness, the visit's session. A head spans every
      project, so without the project a turn in one project would read
      another project's turn as the one before it - in the history the
      office is shown, in the answer a "yes please" gives, and in the
      project the conversation remembers.

    Shaped, not trusted: anything that is not an id is not sent, and an id the
    office does not know costs the project and never the message (below).
    `dedupe_key` keeps the bare session, which is what containment (0598)
    recognises as the page's own.
  */
  const project =
    typeof body.project === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.project)
      ? body.project.toLowerCase()
      : null

  // 1. Canonicalise. `origin_ref` is `session:turn`, matching the
  //    `chat:message` shape every other channel uses, so conversation memory
  //    and the pairing window work here with no special case.
  /*
    A clock reading plus randomness. The clock alone gave two turns posted in
    the same millisecond on one session the SAME dedupe key, so the second was
    ignored as a duplicate and he was told "could not record what you said"
    (found by a concurrency check on #373). Containment (0598) reads only the
    session before the dot, so the turn's shape is free.
  */
  const turn = `${Date.now().toString(36)}${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`
  /*
    The CONVERSATION is the thread the page showed, and it stays that thread
    even when the office cannot file the turn under its project. A stale tab
    on a deleted project must not fall back to the visit's bare session: that
    is the no-project conversation, and a "yes please" joined to it could
    answer a question asked there.
  */
  /*
    H1: the conversation is the person's thread in this project, not this page visit. `conversationHead` derives it from
    the verified office and speaker (never from anything the page sends) and leaves a harness session on its per-visit
    head. The dedupe key below still carries the visit's own session and a fresh turn id, so two turns are never one.
  */
  const talk = await conversationHead({
    office,
    actor: speaker.actor,
    kind: speaker.kind,
    session,
    project,
  })
  const row = (stated: string | null, addressee: string | null): Record<string, unknown> => ({
    // Explicit, from the verified speaker: the compatibility bridge is not asked to guess.
    office_id: office,
    origin_channel: 'voice',
    origin_ref: `${talk}:${turn}`,
    actor: speaker.actor,
    // `subject` is NOT set here. 0056's trigger resolves it through
    // `app.subject_for`, the same way it does for Slack and Telegram — and a
    // channel that writes its own subject is a channel exempt from the
    // identity map. The exemption was invisible until `verify:cross-interface`
    // compared a voice row against a Slack one and found this the only column
    // that differed (0104).
    instruction: said,
    addressed_to: addressee,
    // The selection stays on every retry. The retry exists because a NAME
    // could not be translated, and 0410's trigger already drops the ones that
    // are not real.
    addressed_also: alsoAddressed,
    dedupe_key: `voice:turn:${session}.${turn}`,
    ...(stated === null ? {} : { project_id: stated }),
  })
  const store = (r: Record<string, unknown>) =>
    fetch(`${DB_URL}/rest/v1/inbound_commands`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'resolution=ignore-duplicates,return=representation',
      },
      body: JSON.stringify(r),
    })
  /*
    A foreign key the office refuses is PostgREST's 409 with code 23503 - the
    same status as a duplicate - so a refusal is told apart by its code, not
    by its status.
  */
  const refusedReference = async (r: Response): Promise<boolean> =>
    !r.ok &&
    ((await r
      .clone()
      .json()
      .then((b: { code?: unknown }) => b.code === '23503')
      .catch(() => false)) ||
      r.status !== 409)
  let stated = project
  let attempt = await store(row(stated, addressedTo))
  /*
    A project the office does not know must not cost Grant his message.
    `project_id` has a foreign key to `projects`, so an id that names nothing
    fails the insert. One retry with no project: translation failing honestly.
    The message is then resolved as a message that named no project - never
    guessed onto another one - and stays in its own thread's conversation.
  */
  if (stated !== null && (await refusedReference(attempt))) {
    stated = null
    attempt = await store(row(null, addressedTo))
  }
  /*
    An addressee that is not a person must not cost Grant his message either.

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
  */
  if (addressedTo !== null && (await refusedReference(attempt))) {
    attempt = await store(row(stated, null))
  }
  if (!attempt.ok && attempt.status !== 409) {
    return json({ error: 'could not record what you said' }, 503)
  }
  const rows = (await attempt.json().catch(() => [])) as { command_id?: string }[]
  const commandId = rows[0]?.command_id
  if (commandId === undefined) return json({ error: 'could not record what you said' }, 503)

  // 2. Ask the canonical layer whether this is answerable. The decision is
  //    there, not here.
  const answer = (await rpc('voice_answer', { p_office: office, p_command_id: commandId })) as {
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
      'Right — I have put that to the team. It takes a few minutes. The answer will ' +
      'appear in your project’s chat and on its Team page, and in Slack or Telegram if ' +
      'you have connected them.',
    did: 'delegated',
    job_id: queued.job_id,
    command_id: commandId,
  })
})
