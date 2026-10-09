/**
 * No script drives a real door without declaring the conversation first (#381).
 *
 *   npm run check:door-origins
 *
 * A correctly signed update to the deployed Telegram webhook, a signed Slack
 * event, a turn said through the dashboard gateway or a call to the office's
 * MCP server is indistinguishable, once accepted, from Grant. The runtime fix
 * is `app.register_test_origin` (0605): the door writes a declared
 * conversation's turns synthetic. This is the half that runs before anything
 * is deployed: every script that names one of those doors must call
 * `testOrigins(` (scripts/verify/lib/test-origin.ts), and none may carry an
 * identifier of Grant's real conversations - because a suite that posts AS him
 * from his own chat is the one shape no runtime witness can ever tell apart.
 *
 * The voice door is `check:voice-sessions`' (a session must be named verify-),
 * and scripts/isolated/ is the local replica only (guard.ts refuses anything
 * else), so neither is walked here.
 *
 * It can be asked to prove it can fail: tests/scripts/door-origins.test.ts.
 */
import { readdirSync, readFileSync } from 'node:fs'

export const DOORS: { name: string; re: RegExp }[] = [
  // The path segment, not the whole URL: verify:security builds it as `${base}/slack-events`.
  { name: 'the Telegram webhook', re: /telegram-webhook/ },
  { name: 'the Slack events endpoint', re: /slack-events/ },
  { name: "the office's MCP server", re: /functions\/v1\/mcp\b/ },
  { name: 'the dashboard say path', re: /action:\s*['"](say|send_to_agent)['"]/ },
]

/**
 * Grant's real conversations, as they appear in the office's own tables on
 * 29 September 2026: his private Telegram chat (and its numeric-separator
 * spelling), the office group, his Slack user, and the Slack channels mapped
 * to his real projects. A new one is added here when one is created; the
 * database refuses to declare any of them regardless (0605).
 */
export const REAL_IDENTIFIERS = [
  '1386648496',
  '1_386_648_496',
  '-5444104624',
  'U0BUNF6AALC',
  'C0BVD21Q9S5',
  'C0C276SFM7D',
  'C0C2DAPDN02',
  'C0C28K5HG7P',
  'C0C37PTF7A4',
  'C0BV7ULTCJ1',
]

/** Scripts that name a door and make no turn there, each with the reason. */
export const MAKES_NO_TURN: Record<string, string> = {
  'scripts/deploy/mcp.ts': 'tools/list only: the door answers a listing and makes no work',
  'scripts/audit/credentials.ts':
    'a url_verification challenge: the endpoint echoes it and writes no turn',
  'scripts/telegram/webhooks.ts':
    "sets the webhook URL at Telegram's API; posts nothing to the door",
  'scripts/slack/configure-events.ts':
    'writes the events URL into the app manifest; posts nothing to the door',
  'scripts/check-consumed.ts': 'names the function in a comment',
  'scripts/check-one-brain.ts': "lists the functions' source directories",
  'scripts/deploy/edge-function.ts': 'deploys the function and probes it without a signature',
  'scripts/verify/oauth.ts':
    'registers an OAuth client and redeems a code; never calls a tool, so the door makes no work',
  'scripts/check-door-origins.ts': 'this check',
  'scripts/release/bundle-manifest.ts':
    'names the telegram-webhook and slack-events bundles to say which services differ from a commit; reads files and git, contacts nothing',
}

/**
 * What a turn looks like in a request body. An exemption is a claim, so it is
 * checked: a script excused for making no turn must contain none of these.
 */
export const MAKES_A_TURN =
  /tools\/call|event_callback|block_actions|callback_query:\s*\{|\bmessage:\s*\{|action:\s*['"](say|send_to_agent)['"]/

export interface Violation {
  file: string
  why: string
}

export function doorViolations(files: { path: string; src: string }[]): Violation[] {
  const out: Violation[] = []
  for (const { path, src } of files) {
    const doors = DOORS.filter((d) => d.re.test(src))
    if (doors.length === 0) continue
    if (MAKES_NO_TURN[path] !== undefined) {
      if (path !== 'scripts/check-door-origins.ts' && MAKES_A_TURN.test(src))
        out.push({ file: path, why: 'is excused for making no turn, and its source builds one' })
      continue
    }
    if (!/\btestOrigins\(\s*db\b/.test(src))
      out.push({
        file: path,
        why: `drives ${doors.map((d) => d.name).join(' and ')} without declaring a test origin first`,
      })
    for (const id of REAL_IDENTIFIERS)
      if (src.includes(id))
        out.push({
          file: path,
          why: `drives a real door and names ${id}, one of Grant's real conversations`,
        })
  }
  return out
}

const walk = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? e.name === 'isolated' || e.name === 'node_modules'
        ? []
        : walk(`${dir}/${e.name}`)
      : e.name.endsWith('.ts')
        ? [`${dir}/${e.name}`]
        : [],
  )

if (process.argv[1]?.endsWith('check-door-origins.ts')) {
  const files = walk('scripts').map((path) => ({ path, src: readFileSync(path, 'utf8') }))
  const reaching = files.filter((f) => DOORS.some((d) => d.re.test(f.src)))
  if (reaching.length < 5) {
    console.error(
      `check:door-origins CANNOT RUN — found ${String(reaching.length)} door-reaching scripts; a scan that finds nothing proves nothing.`,
    )
    process.exit(2)
  }
  const bad = doorViolations(files)
  console.log(
    `  scripts that name a real door: ${String(reaching.length)} · declare first: ${String(reaching.length - Object.keys(MAKES_NO_TURN).filter((p) => reaching.some((r) => r.path === p)).length)} · make no turn: ${String(Object.keys(MAKES_NO_TURN).filter((p) => reaching.some((r) => r.path === p)).length)} · violations: ${String(bad.length)}`,
  )
  if (bad.length > 0) {
    console.error(
      ['', 'check:door-origins FAILED', ...bad.map((v) => `  ${v.file}: ${v.why}`)].join('\n'),
    )
    process.exit(1)
  }
}
