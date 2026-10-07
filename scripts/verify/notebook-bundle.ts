/**
 * Acceptance test for the `excludeFiles` change: after the static site is excluded, do both Python functions still work?
 *
 *   npm run verify:notebook-bundle                       # python3 must be able to import notebooklm
 *   NOTEBOOK_BUNDLE_PYTHON=/path/to/venv/bin/python npm run verify:notebook-bundle
 *
 * "The page loads" does not prove this: the one runtime file the exclusion could remove is `scripts/notebook/act.py`, which
 * `api/notebook-act.py` spawns with the Python it runs under. So this builds each function's bundle the way Vercel does (the
 * page upload set minus the function's real `excludeFiles` from vercel.json), writes it to a temp directory, serves the REAL
 * function from inside that directory on a loopback port, and sends one request matrix to three bundles:
 *
 *   baseline  nothing excluded                    what runs today
 *   candidate the real excludeFiles per function  what would ship
 *   control   the candidate PLUS `scripts/**`      deliberately loses act.py; the acceptance checks MUST fail on it
 *
 * What it proves: act.py (and the function sources, requirements.txt, vercel.json) are present where the runtime looks for them;
 * the reader imports the library and answers; the writer spawns act.py and gets a handled answer back; every auth and input
 * refusal is unchanged (status and body digest equal to baseline); and the checks can fail (the control).
 *
 * What it does NOT prove, stated here so nobody assumes it: the size on Vercel's disk (only a preview can say; this reports the
 * raw bytes of the uploaded files removed); behaviour with a real Google session (every request carries a deliberately invalid
 * cookie jar, which the library rejects locally, and the child's proxy is pointed at a closed port so any attempt to reach the
 * network would show as a connection error, not a pass); dependency resolution on Vercel (the function runs under a local Python
 * that already has notebooklm-py); a real notebook READ or WRITE. No production data is touched, no Vercel or Supabase call is
 * made, no deployment exists, and the throwaway secret is random per run and never printed.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { modelBundle } from '../deploy/lib/function-bundle-model.ts'
import { collectPageFiles } from '../deploy/lib/page-files.ts'

const PYTHON = process.env.NOTEBOOK_BUNDLE_PYTHON ?? 'python3'
const SERVER = join(process.cwd(), 'scripts/verify/lib/serve-function.py')
const SECRET = randomBytes(24).toString('hex')
const JAR = JSON.stringify({ cookies: [], origins: [] }) // deliberately invalid: no Google session
const FUNCTIONS = ['api/notebook.py', 'api/notebook-act.py'] as const
const CONTROL_EXTRA = 'scripts/**'

let failed = 0
const check = (ok: boolean, what: string): void => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failed += 1
}
const digest = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 12)

// ---- the library must be importable, or nothing below means anything -------------------------------------------------
const probe = await new Promise<{ code: number | null; out: string }>((resolve) => {
  const p = spawn(PYTHON, ['-c', 'import notebooklm; print("ok")'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  p.stdout.on('data', (d) => {
    out += String(d)
  })
  p.on('error', () => resolve({ code: -1, out: '' }))
  p.on('close', (code) => resolve({ code, out }))
})
if (probe.code !== 0 || !probe.out.includes('ok')) {
  console.error(
    `NOT PROVEN: ${PYTHON} cannot import notebooklm, so the writer's act.py would fail for a reason that has nothing to do with the exclusion. ` +
      'Point NOTEBOOK_BUNDLE_PYTHON at a Python with notebooklm-py installed. Nothing was checked.',
  )
  process.exit(2)
}

// ---- the real configuration ------------------------------------------------------------------------------------------
const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
  functions?: Record<string, { excludeFiles?: string }>
}
const realGlob = (fn: string): string => {
  const g = vercel.functions?.[fn]?.excludeFiles
  if (g === undefined) throw new Error(`vercel.json has no excludeFiles for ${fn}`)
  return g
}
const uploaded = await collectPageFiles('.')
const sizes = new Map([...uploaded].map(([p, b]) => [p, b.length]))

type Variant = 'baseline' | 'candidate' | 'control'
const globsFor = (v: Variant, fn: string): string[] =>
  v === 'baseline' ? [] : v === 'candidate' ? [realGlob(fn)] : [realGlob(fn), CONTROL_EXTRA]

const root = mkdtempSync(join(tmpdir(), 'nbundle-'))
const children: ChildProcess[] = []
const stopAll = (): void => {
  for (const c of children) c.kill('SIGKILL')
  rmSync(root, { recursive: true, force: true })
}
process.on('exit', stopAll)

/** Write a bundle to disk and serve one function from it. Returns the port. */
async function serve(v: Variant, fn: string): Promise<{ port: number; dir: string }> {
  const model = modelBundle(sizes, globsFor(v, fn))
  const dir = join(root, `${v}-${fn.replace(/\W/g, '_')}`)
  for (const path of model.kept) {
    const target = join(dir, path)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, uploaded.get(path) as Buffer)
  }
  const child = spawn(PYTHON, [SERVER, join(dir, fn)], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      NOTEBOOK_READER_SECRET: SECRET,
      // Any attempt to reach a real host fails here, visibly, instead of succeeding.
      HTTPS_PROXY: 'http://127.0.0.1:9',
      HTTP_PROXY: 'http://127.0.0.1:9',
      ALL_PROXY: 'http://127.0.0.1:9',
    },
  })
  children.push(child)
  const port = await new Promise<number>((resolve, reject) => {
    let buf = ''
    const timer = setTimeout(() => reject(new Error(`${v} ${fn}: server did not start`)), 15_000)
    child.stdout?.on('data', (d) => {
      buf += String(d)
      const n = Number.parseInt(buf.split('\n')[0] ?? '', 10)
      if (Number.isInteger(n) && n > 0) {
        clearTimeout(timer)
        resolve(n)
      }
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      reject(new Error(`${v} ${fn}: server exited (${String(code)}) before it started`))
    })
  })
  return { port, dir }
}

type Case = {
  name: string
  fn: (typeof FUNCTIONS)[number]
  method: 'GET' | 'POST'
  auth: 'good' | 'none' | 'wrong'
  body: string | null
  /** The status every variant that holds act.py must give. */
  status: number
}
const js = (o: unknown): string => JSON.stringify(o)
const R = 'api/notebook.py'
const W = 'api/notebook-act.py'
const MATRIX: Case[] = [
  { name: 'reader liveness', fn: R, method: 'GET', auth: 'none', body: null, status: 200 },
  {
    name: 'reader no auth',
    fn: R,
    method: 'POST',
    auth: 'none',
    body: js({ op: 'notebooks', storage_state: JAR }),
    status: 401,
  },
  {
    name: 'reader wrong bearer',
    fn: R,
    method: 'POST',
    auth: 'wrong',
    body: js({ op: 'notebooks', storage_state: JAR }),
    status: 401,
  },
  { name: 'reader empty body', fn: R, method: 'POST', auth: 'good', body: '', status: 400 },
  {
    name: 'reader not JSON',
    fn: R,
    method: 'POST',
    auth: 'good',
    body: 'not json at all',
    status: 400,
  },
  {
    name: 'reader unknown op',
    fn: R,
    method: 'POST',
    auth: 'good',
    body: js({ op: 'nope', storage_state: JAR }),
    status: 400,
  },
  {
    name: 'reader missing storage',
    fn: R,
    method: 'POST',
    auth: 'good',
    body: js({ op: 'notebooks' }),
    status: 400,
  },
  // Imports notebooklm in-process and is refused by the library for the jar, before any request: a handled 502.
  {
    name: 'reader notebooks, invalid jar (imports the library)',
    fn: R,
    method: 'POST',
    auth: 'good',
    body: js({ op: 'notebooks', storage_state: JAR }),
    status: 502,
  },
  { name: 'writer liveness', fn: W, method: 'GET', auth: 'none', body: null, status: 200 },
  {
    name: 'writer no auth',
    fn: W,
    method: 'POST',
    auth: 'none',
    body: js({ action: 'notebooks', storage_state: JAR }),
    status: 401,
  },
  {
    name: 'writer wrong bearer',
    fn: W,
    method: 'POST',
    auth: 'wrong',
    body: js({ action: 'notebooks', storage_state: JAR }),
    status: 401,
  },
  {
    name: 'writer unknown action',
    fn: W,
    method: 'POST',
    auth: 'good',
    body: js({ action: 'nope', storage_state: JAR }),
    status: 400,
  },
  {
    name: 'writer missing storage',
    fn: W,
    method: 'POST',
    auth: 'good',
    body: js({ action: 'notebooks' }),
    status: 400,
  },
  {
    name: 'writer args not an object',
    fn: W,
    method: 'POST',
    auth: 'good',
    body: js({ action: 'notebooks', storage_state: JAR, args: 5 }),
    status: 400,
  },
  // The one request that spawns scripts/notebook/act.py: a handled answer (200, ok:false), not a 500 about the script.
  {
    name: 'writer notebooks, invalid jar (spawns act.py)',
    fn: W,
    method: 'POST',
    auth: 'good',
    body: js({ action: 'notebooks', storage_state: JAR }),
    status: 200,
  },
]

type Seen = { status: number; hash: string; text: string }
async function ask(port: number, c: Case): Promise<Seen> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (c.auth === 'good') headers.Authorization = `Bearer ${SECRET}`
  if (c.auth === 'wrong') headers.Authorization = `Bearer ${SECRET}x`
  const res = await fetch(`http://127.0.0.1:${String(port)}/${c.fn.replace(/\.py$/, '')}`, {
    method: c.method,
    headers,
    ...(c.body === null ? {} : { body: c.body }),
    signal: AbortSignal.timeout(70_000),
  })
  const text = await res.text()
  return { status: res.status, hash: digest(text), text }
}

/** Run the whole matrix against one variant of both functions. Never throws on a refusal: a refusal is a result. */
async function runVariant(
  v: Variant,
): Promise<{ seen: Map<string, Seen>; dirs: Record<string, string> }> {
  const ports = new Map<string, number>()
  const dirs: Record<string, string> = {}
  for (const fn of FUNCTIONS) {
    const s = await serve(v, fn)
    ports.set(fn, s.port)
    dirs[fn] = s.dir
  }
  const seen = new Map<string, Seen>()
  for (const c of MATRIX) seen.set(c.name, await ask(ports.get(c.fn) as number, c))
  return { seen, dirs }
}

console.log(`python: ${PYTHON}; secret: random per run, not printed`)
console.log(
  '\nbaseline (nothing excluded), candidate (the real excludeFiles), control (candidate + scripts/**):',
)
const base = await runVariant('baseline')
const cand = await runVariant('candidate')
const ctrl = await runVariant('control')

// ---- 1. what is in each bundle ---------------------------------------------------------------------------------------
console.log('\n1. the bundle holds what the runtime looks for')
const present = (dirs: Record<string, string>, fn: string, rel: string): boolean => {
  try {
    readFileSync(join(dirs[fn] as string, rel))
    return true
  } catch {
    return false
  }
}
for (const fn of FUNCTIONS) {
  for (const rel of [
    'api/notebook.py',
    'api/notebook-act.py',
    'scripts/notebook/act.py',
    'requirements.txt',
    'vercel.json',
  ]) {
    check(present(cand.dirs, fn, rel), `${fn} candidate bundle holds ${rel}`)
  }
  const m = modelBundle(sizes, [realGlob(fn)])
  check(
    !m.kept.some(
      (p) => p === 'index.html' || p.startsWith('studio/') || /^[^/]+\.(css|html|js)$/.test(p),
    ),
    `${fn} candidate bundle holds no static site file (${String(m.removed.length)} removed, ${(m.removedBytes / 1048576).toFixed(2)} MiB raw)`,
  )
}
check(
  !present(ctrl.dirs, W, 'scripts/notebook/act.py'),
  'control bundle really lacks act.py (the sabotage landed)',
)

// ---- 2. the matrix, candidate against its expectations and against baseline -------------------------------------------
console.log(
  '\n2. every request: expected status, and identical to the unexcluded bundle (status and body digest)',
)
for (const c of MATRIX) {
  const b = base.seen.get(c.name) as Seen
  const k = cand.seen.get(c.name) as Seen
  check(k.status === c.status, `${c.name}: ${String(k.status)} (expected ${String(c.status)})`)
  check(k.status === b.status && k.hash === b.hash, `${c.name}: identical to baseline (${k.hash})`)
}

// ---- 3. the writer's answer really came from act.py ---------------------------------------------------------------------
console.log('\n3. the writer ran act.py, and the reader ran the library')
const wk = cand.seen.get('writer notebooks, invalid jar (spawns act.py)') as Seen
const wj = (() => {
  try {
    return JSON.parse(wk.text) as { ok?: unknown; error?: unknown }
  } catch {
    return {} as { ok?: unknown; error?: unknown }
  }
})()
check(wj.ok === false, 'writer answered as a handled failure (ok:false), the shape act.py prints')
check(
  typeof wj.error === 'string' &&
    !/not in this deployment|ModuleNotFoundError|No module named/i.test(wj.error),
  'the writer failure is about the jar, not a missing script or a missing library',
)
const rk = cand.seen.get('reader notebooks, invalid jar (imports the library)') as Seen
check(
  !/ModuleNotFoundError|No module named|ImportError/i.test(rk.text),
  'the reader imported the library (no import error in its answer)',
)
check(
  !/ECONN|ProxyError|connect/i.test(`${wk.text}${rk.text}`),
  'no request left the machine: no connection error in either answer (the proxy is a closed port)',
)

// ---- 4. nothing echoed ------------------------------------------------------------------------------------------------------
console.log('\n4. no secret or credential in any answer')
const everything = [base, cand, ctrl]
  .flatMap((r) => [...r.seen.values()].map((s) => s.text))
  .join('\n')
check(!everything.includes(SECRET), 'the throwaway secret appears in no response')
check(!everything.includes(JAR), 'the submitted cookie jar appears in no response')

// ---- 5. the control: the same checks must FAIL when act.py is gone ---------------------------------------------------
console.log('\n5. control: with act.py excluded the acceptance checks must fail')
const cw = ctrl.seen.get('writer notebooks, invalid jar (spawns act.py)') as Seen
const wouldPass =
  cw.status === 200 &&
  cw.hash === (base.seen.get('writer notebooks, invalid jar (spawns act.py)') as Seen).hash
check(
  !wouldPass,
  `the writer check fails on the control (status ${String(cw.status)}: ${cw.text.slice(0, 40).replace(/[/\\][^ "]*/g, '<path>')}...)`,
)
check(
  /act\.py is not in this deployment/.test(cw.text),
  'and it fails for the right reason: the function names the missing script',
)
const others = MATRIX.filter((c) => c.name !== 'writer notebooks, invalid jar (spawns act.py)')
check(
  others.every((c) => (ctrl.seen.get(c.name) as Seen).status === c.status),
  'every other request is unaffected by losing act.py (so the writer check is the one that discriminates)',
)

console.log(`\nnotebook bundle acceptance: ${failed === 0 ? 'PASS' : `FAIL (${String(failed)})`}`)
// The function servers keep the event loop alive; stop them and leave explicitly so the verdict is also the exit code.
stopAll()
process.exit(failed === 0 ? 0 : 1)
