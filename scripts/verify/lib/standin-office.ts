/**
 * A stand-in office for a browser suite that needs a signed-in page with ONE project and ONE crew member, without a real gateway.
 *
 * Why it exists. Several suites stored a made-up token and aborted every `hq-api` request, relying on the failed read leaving the
 * prototype's invented project on screen. Since #426 a signed-in person whose office does not answer is shown no projects at all,
 * which is correct, so those suites lost their subject. This answers the reads honestly instead: the studio section holds one
 * project, the layout section is empty, every other section is an empty list, and a write is refused as a stand-in would.
 */
import type { Route } from 'playwright'

export const STAND_IN_SLUG = 'riverside'
export const STAND_IN_PATH = `/p/${STAND_IN_SLUG}`

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type, apikey, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'content-type': 'application/json',
}

export const fulfillStandIn = async (route: Route): Promise<void> => {
  const req = route.request()
  if (req.method() === 'OPTIONS') {
    await route.fulfill({ status: 204, headers: CORS })
    return
  }
  if (req.method() !== 'GET') {
    await route.fulfill({
      status: 200,
      headers: CORS,
      body: JSON.stringify({ result: { ok: true } }),
    })
    return
  }
  const section = new URL(req.url()).searchParams.get('section')
  const body =
    section === 'studio'
      ? {
          data: {
            generated_at: new Date().toISOString(),
            crew: [
              { slug: 'chief-of-staff', name: 'Claire', role: 'Chief of Staff', state: 'idle' },
            ],
            projects: [
              {
                slug: STAND_IN_SLUG,
                name: 'Riverside',
                purpose: 'A made-up project for a browser suite.',
                tasks: [],
                documents: [],
                contacts: [],
                sources: [],
                activity: [],
                waiting: [],
                modules: [],
                requests: [],
                layout_board: null,
              },
            ],
          },
        }
      : section === 'layout'
        ? { data: { panels: null, rev: 0, now: Date.now() } }
        : { data: [] }
  await route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(body) })
}
