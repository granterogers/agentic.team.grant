/*
 * WHICH OFFICE A BROWSER CHECK'S PAGE BELONGS TO.
 *
 * Six modules under `web/studio` used to fall back to one project's gateway,
 * so a suite that named no office still got a URL with `hq-api` in it and its
 * own fetch shim matched. ADR-0048 removed the fallback: a page nothing has
 * configured resolves its gateway to the EMPTY STRING and refuses honestly,
 * which is the point for a person and leaves a harness posting to the page's
 * own origin — where the shim never fires, and the suite reports that nothing
 * reached the office about a page that had nowhere to reach.
 *
 * Seventeen suites stub the office by matching `hq-api` in a URL. They worked
 * afterwards only where `web/studio/config.js` happened to exist, and that
 * file is generated and gitignored — so they passed on a machine somebody had
 * deployed from and failed on a fresh checkout. CLAUDE.md's rule: a test that
 * depends on a property of the environment is a test that will invert the day
 * the environment changes.
 *
 * So a suite names one, at the seam the product documents. The address CANNOT
 * be reached — `.invalid` is reserved by RFC 2606 for exactly this — so a
 * suite that forgets to stub something fails loudly rather than quietly
 * talking to a real office.
 */
import '../../../src/safety/arm.ts'

/** The gateway a browser check points at when it stubs the office itself. */
export const NOWHERE = 'https://office.invalid/functions/v1/hq-api'

/**
 * An init script naming that office.
 *
 * Runs before the page's first line, so it wins over `config.js` — which is
 * written as `window.HQ_API = window.HQ_API || …` precisely so an explicit
 * value is never clobbered.
 */
export const namesAnOffice = (gateway: string = NOWHERE): string =>
  `window.HQ_API = ${JSON.stringify(gateway)}`

/**
 * The office this repository's commands default to, for a suite whose writes
 * go over the wire.
 *
 * Not every browser check stubs everything: `verify:tasks-ui` answers the
 * page's READS from a fixture and deliberately lets the WRITE reach the
 * deployed gateway, because the defect it exists for lives in the round trip.
 * Pointing that at an unreachable host would prove nothing and say
 * "10 POST(s) never left the sandbox".
 *
 * `SUPABASE_PROJECT_REF` keeps the same default every other command in
 * `scripts/` has, and F-009 records why that default must stay.
 */
export const theRealOffice = (): string => {
  const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
  return `https://${ref}.supabase.co/functions/v1/hq-api`
}
