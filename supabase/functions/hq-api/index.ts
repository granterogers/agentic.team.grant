/**
 * The Team HQ read API.
 *
 * One endpoint, four sections, no SQL from the client — ever. The browser names
 * a SECTION from a fixed list and the projection lives in `app.hq_*` (0045)
 * where it can be reviewed. Letting a page send a query, or even a table name,
 * is how a private dashboard becomes a data export.
 *
 * The RPCs it calls are the `public` wrappers from 0046, not the `app`
 * functions themselves: PostgREST serves only the schemas it is configured for.
 * That cost a silent failure in the Telegram webhook before it was understood,
 * and it is written down here so the next endpoint does not rediscover it.
 *
 * ## Why it is not PostgREST with the anon key
 *
 * The obvious build is: expose the tables, hand the browser the publishable
 * key, write RLS. Three problems, and the third is the one that settles it.
 *
 *   1. The RLS in this database is written for `ai_team_app`, a server role.
 *      Rewriting every policy for an anonymous browser is a large change to the
 *      security model in service of a dashboard.
 *   2. `usable_models` and `credential_health` carry `secret_ref`. Not secrets,
 *      but exactly the "token/debug detail" §25 says must not appear.
 *   3. There is one user and no login. Any key the page holds is a key anyone
 *      holding the URL holds, so the question is only ever "what can that key
 *      do" — and the answer should be "read four fixed shapes", not "query the
 *      database".
 *
 * ## The token
 *
 * A single bearer token, compared in constant time. It is not a password and
 * not a session: it is a capability, it grants exactly these four reads, and it
 * can be rotated by changing one vault row. Grant keeps it in the page's
 * `localStorage`.
 *
 * `verify_jwt` is false because the browser has no Supabase JWT to present.
 * This token is the whole of the authentication, which is why an absent one
 * rejects everything rather than waving requests through.
 */

const HQ_TOKEN = Deno.env.get('HQ_API_TOKEN') ?? ''
const DB_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

/** The complete list. A section not named here does not exist. */
const SECTIONS: Readonly<Record<string, { fn: string; args?: Record<string, unknown> }>> = {
  overview: { fn: 'hq_overview' },
  staff: { fn: 'hq_staff' },
  usage: { fn: 'hq_usage' },
  activity: { fn: 'hq_activity', args: { p_limit: 50 } },
  series: { fn: 'hq_series', args: { p_days: 30 } },
  connections: { fn: 'hq_connections' },
  projects: { fn: 'hq_projects' },
  artifacts: { fn: 'hq_artifacts' },
  settings: { fn: 'hq_settings' },
  team: { fn: 'hq_team' },
  google: { fn: 'hq_google' },
  // What to do next, for a person who has just opened this for the first time.
  setup: { fn: 'hq_setup' },
  // What each kind of work costs, measured and modelled (§11).
  cost: { fn: 'hq_cost_per_outcome', args: { p_days: 30 } },
}

/**
 * The things the page may CHANGE, as opposed to read.
 *
 * Team HQ is read-only because a dashboard where you can do something
 * irreversible by accident is worse than one where you can do nothing. That
 * reasoning is about *acting* — cancelling a job, approving an output — and not
 * about *configuring*. Attaching a Notion database is a row; detaching it is
 * another row; neither loses anything, because the corpus a connector fed
 * survives the connector being removed (ADR-0013).
 *
 * So configuration is writable and action stays read-only, and the line
 * between them is this list. Deleting a project is deliberately absent: it
 * cascades to documents, and the rule is that a route may be closed and a
 * corpus is kept.
 */
const ACTIONS: Readonly<Record<string, { fn: string; required: readonly string[] }>> = {
  create_project: { fn: 'hq_create_project', required: ['p_name', 'p_connector', 'p_ref'] },
  rename_project: { fn: 'hq_rename_project', required: ['p_slug', 'p_name'] },
  attach: { fn: 'hq_attach', required: ['p_slug', 'p_connector', 'p_ref'] },
  detach: { fn: 'hq_detach', required: ['p_attachment_id'] },
  // One setter over an allow-list of six keys, enforced in the function rather
  // than here — the page is not the only thing that could call this, and a
  // guard in the caller is a guard in one of the callers.
  set_setting: { fn: 'hq_set_setting', required: ['p_key', 'p_value'] },
  // Editing a person, and retiring one. There is no delete and there will not
  // be: outputs, routing decisions and deliveries all name a staff member, and
  // a roster that can lose a row is a history that stops explaining itself.
  staff_update: { fn: 'hq_staff_update', required: ['p_slug'] },
  // Per-person tool grants. Never a way past tool_permissions: the RPC ANDs
  // the two, and refuses a grant for a globally disabled tool (§11).
  staff_tool_set: { fn: 'hq_staff_tool_set', required: ['p_slug', 'p_tool', 'p_granted'] },
  staff_retire: { fn: 'hq_staff_retire', required: ['p_slug', 'p_active'] },
  // Write-only by construction: there is no matching section that reads it
  // back, and `hq_google` reports only whether one exists.
  set_google_secret: { fn: 'hq_set_google_secret', required: ['p_secret'] },
  // The way back out. There was a way in and none out, which made a consent
  // granted through a browser effectively permanent from this page's side.
  forget_google: { fn: 'hq_forget_google', required: [] },
}

/**
 * Constant-time comparison.
 *
 * A dashboard token is guessable by timing in principle and it costs four lines
 * not to be. Both sides are hashed to a fixed width first, because comparing
 * raw strings of different lengths is itself a length oracle — the same
 * reasoning as `src/channels/telegram.ts`.
 */
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
      // The page is served from Vercel and this from Supabase, so it is
      // cross-origin by construction (ADR-0011: Supabase cannot serve HTML).
      // Wide open is acceptable ONLY because the bearer token is the whole of
      // the authorisation and is never a cookie — there is no ambient
      // credential for another origin to ride on.
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization, content-type',
      'cache-control': 'no-store',
    },
  })

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === 'OPTIONS') return json({ ok: true })

  if (request.method === 'GET' && new URL(request.url).pathname.endsWith('/health')) {
    // Deliberately says nothing about configuration beyond whether a token is
    // present at all. An unauthenticated caller learning which sections exist
    // is a probing aid.
    return json({ ok: true, endpoint: 'hq-api', token_configured: HQ_TOKEN !== '' })
  }

  const presented = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!(await tokenMatches(presented))) {
    return json({ error: 'unauthorized' }, 401)
  }

  // --- configuration -------------------------------------------------------
  //
  // POST, and only the named actions. Same rule as the reads: the page names an
  // ACTION from a fixed list and the projection lives in `app.hq_*` where it
  // can be reviewed. A page that could send SQL, or even a function name, is a
  // page that has the database rather than a dashboard.
  if (request.method === 'POST') {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const actionName = String(body.action ?? '')
    const action = Object.hasOwn(ACTIONS, actionName) ? ACTIONS[actionName] : undefined
    if (action === undefined) {
      return json({ error: 'unknown action', actions: Object.keys(ACTIONS) }, 400)
    }
    const args = (body.args ?? {}) as Record<string, unknown>
    const missing = action.required.filter(
      (k) => args[k] === undefined || args[k] === null || String(args[k]).trim() === '',
    )
    if (missing.length > 0) {
      return json({ error: `missing: ${missing.join(', ')}` }, 400)
    }

    const done = await fetch(`${DB_URL}/rest/v1/rpc/${action.fn}`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    })
    if (!done.ok) {
      console.error(`hq-api ${actionName}: upstream ${String(done.status)}`)
      return json({ error: 'the action failed' }, 502)
    }
    return json({ action: actionName, result: await done.json() })
  }

  const url = new URL(request.url)
  const name = url.searchParams.get('section') ?? 'overview'
  // `Object.hasOwn`, not a bare lookup. `SECTIONS['constructor']` and
  // `SECTIONS['__proto__']` are both truthy through the prototype chain, so a
  // bare `!== undefined` let three inherited names past the guard and on to a
  // fetch of `/rpc/undefined` with the service key. Nothing came back and
  // nothing leaked — but the comment above says "a section not named here does
  // not exist", and until now that was not true.
  const section = Object.hasOwn(SECTIONS, name) ? SECTIONS[name] : undefined
  if (section === undefined) {
    return json({ error: 'unknown section', sections: Object.keys(SECTIONS) }, 400)
  }

  const response = await fetch(`${DB_URL}/rest/v1/rpc/${section.fn}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(section.args ?? {}),
  })

  if (!response.ok) {
    // The upstream detail stays here. A database error message in a browser is
    // schema disclosure, and it is also the "raw debug detail" §25 forbids.
    console.error(`hq-api ${name}: upstream ${String(response.status)}`)
    return json({ error: 'upstream failed', section: name }, 502)
  }

  return json({ section: name, data: await response.json() })
})
