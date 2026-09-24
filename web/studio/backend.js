/*
  WHICH OFFICE THIS DASHBOARD BELONGS TO.

  ## The defect this exists to close

  Six modules each opened with the same two lines:

      const API =
        window.HQ_API || 'https://<a project ref>.supabase.co/functions/v1/hq-api'

  which is one person's office written into generic product code, six times.
  Every consequence of that is bad and none of them is loud:

    - somebody who clones this repository and deploys it gets a dashboard
      pointing at SOMEBODY ELSE'S office. Nothing leaks -- the gateway verifies
      the session with Supabase and checks its own membership list, so a
      stranger is refused -- but they are refused with a 401 and no explanation,
      which reads as "this product is broken" rather than "you have not told it
      where your office is".
    - the address is in six places, so the day a project reference changes,
      five of them are right.
    - and there is no state that means "not configured", so the page cannot say
      the one true thing it knows.

  ## The shape of the fix

  One resolver. Nothing in `web/` names an office; a DEPLOYMENT names its own,
  in `config.js`, which is generated at deploy time and is not in the
  repository. `npm run check:backend-ref` is the structural check that keeps it
  that way, and it is proved by putting a fallback back and watching it go red.

  ## What "fails honestly" means here

  When nothing has been configured these export the empty string. They do NOT
  fall back to anything, and callers must not invent a default -- a request to
  a guessed address is the defect above with extra steps. `office.js` treats an
  unconfigured backend exactly as it treats an unreachable one, which is a
  state the page already renders truthfully: it says it could not look, and it
  never says there is nothing there.

  ## What this is not

  It is not a credential. The gateway's address is public -- the browser calls
  it -- and the authorization boundary is entirely server-side: a Supabase Auth
  session, verified with Supabase, plus the office's own membership list.
  Nothing in this file is secret, and nothing in `config.js` is either.
*/

/** One reading of a global, tolerant of the page being served with no config. */
const named = (key) => {
  const v = globalThis[key]
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : ''
}

/** The gateway. Empty when this deployment has not been told which office. */
export const HQ_API = named('HQ_API')

/** Whether this dashboard knows which office it belongs to at all. */
export const configured = () => HQ_API !== ''

/*
  The siblings, each derived from the gateway rather than written down again,
  with an override apiece because the experiment runs its own copies under
  different slugs (ADR-0043). A regex anchored on `/hq-api` quietly returns the
  GATEWAY url when the slug is `hq-api-basecamp`, so the optional suffix in
  these patterns is load-bearing.
*/
const sibling = (name) =>
  HQ_API === '' ? '' : HQ_API.replace(/\/hq-api(-[a-z]+)?\/?$/, `/${name}`)

/** Where a magic link is asked for. Beside the gateway, whatever it is. */
export const SIGNIN = named('HQ_SIGNIN') || sibling('signin')

/** Where a turn is posted. */
export const CHAT = named('HQ_CHAT') || sibling('chat')

/** The voice function, and the short-lived token that lets a browser join. */
export const VOICE = named('HQ_VOICE') || sibling('voice')
export const VOICE_TOKEN = sibling('voice-token')

/** Where the Google connection flow begins. */
export const GOOGLE_START = HQ_API === '' ? '' : `${sibling('google-oauth')}/start`

/*
  The avatars, which are in storage rather than in a function -- a different
  service on the same project, so the derivation cuts further back.
*/
export const AVATARS =
  HQ_API === ''
    ? ''
    : HQ_API.replace(/\/functions\/v1\/.*$/, '/storage/v1/object/public/avatars')

/*
  The sentence a surface shows when there is no office to ask. It names the
  step rather than the symptom, because CLAUDE.md is explicit that an avoidable
  request for manual configuration is a design failure and the least a page can
  do is say which command supplies it.
*/
export const UNCONFIGURED =
  'This dashboard has not been told which office it belongs to. ' +
  'Run npm run config:site against your own project and deploy again.'
