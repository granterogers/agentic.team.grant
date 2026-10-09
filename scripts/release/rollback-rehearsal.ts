/**
 * Rehearse the ROLLBACK of captured edge-function bundles against an isolated target: a throwaway HTTP server on the loopback interface.
 *
 *   npx tsx scripts/release/rollback-rehearsal.ts <rollback-dir> [slug.vN ...]
 *
 * For each captured function it builds the restore request with `buildRestorePlan` (the same request `restore-function.ts` sends to the
 * platform), sends it to http://127.0.0.1:<port>, and checks what arrived: the metadata (name, entrypoint, verify_jwt), one part per
 * source file, and every part's sha256 equal to the one recorded at capture. It also checks the bundle is CLOSED (every relative import
 * resolves to a file in the bundle, in the platform's frame). Nothing leaves the machine: no credential is read, no production URL is
 * contacted, and the production-write gate is not involved because nothing is written anywhere but this process's memory. What it cannot show
 * is that the platform's bundler accepts the upload; that only a real restore proves.
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { closureProblems } from '../deploy/lib/bundle.ts'
import { buildRestorePlan, RestoreRefusal } from '../lib/restore-plan.ts'

const [root, ...only] = process.argv.slice(2)
if (root === undefined) {
  console.error('usage: rollback-rehearsal.ts <rollback-dir> [slug.vN ...]')
  process.exit(2)
}
const dirs = readdirSync(root)
  .filter((n) => statSync(join(root, n)).isDirectory())
  .filter((n) => only.length === 0 || only.includes(n))
const sha = (b: Uint8Array): string => createHash('sha256').update(b).digest('hex')

type Arrived = {
  fields: Map<string, string>
  files: { name: string; sha: string; bytes: number }[]
}
let last: Arrived | null = null
const server = createServer((req, res) => {
  const chunks: Buffer[] = []
  req.on('data', (c: Buffer) => chunks.push(c))
  req.on('end', () => {
    void (async () => {
      const body = Buffer.concat(chunks)
      const form = await new Response(body, {
        headers: { 'content-type': String(req.headers['content-type']) },
      }).formData()
      const fields = new Map<string, string>()
      const files: Arrived['files'] = []
      for (const [k, v] of form.entries()) {
        if (typeof v === 'string') fields.set(k, v)
        else
          files.push({
            name: v.name,
            sha: sha(new Uint8Array(await v.arrayBuffer())),
            bytes: v.size,
          })
      }
      last = { fields, files }
      res.writeHead(201, { 'content-type': 'application/json' }).end('{"status":"rehearsal"}')
    })()
  })
})
await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok))
const addr = server.address()
const port = typeof addr === 'object' && addr !== null ? addr.port : 0

let bad = 0
for (const d of dirs) {
  const dir = join(root, d)
  const row = JSON.parse(readFileSync(join(dir, 'RESTORE.json'), 'utf8')) as {
    slug: string
    entrypoint: string
    verify_jwt: boolean
    bundle_sha256: string
    files: { path: string; sha256: string; bytes: number }[]
  }
  const problems: string[] = []
  let plan: ReturnType<typeof buildRestorePlan>
  try {
    plan = buildRestorePlan(dir)
  } catch (e) {
    // a capture that changed since it was taken is refused by the plan itself: that is a failed rehearsal, not a crash
    console.log(`FAIL ${d}: ${e instanceof RestoreRefusal ? e.message : String(e)}`)
    bad += 1
    continue
  }
  last = null
  const sent = await fetch(
    `http://127.0.0.1:${String(port)}/v1/projects/rehearsal/functions/deploy?slug=${plan.slug}`,
    {
      method: 'POST',
      body: plan.form,
    },
  )
  const arrived = last as Arrived | null
  if (sent.status !== 201 || arrived === null)
    problems.push(`the isolated target answered ${String(sent.status)}`)
  else {
    const meta = JSON.parse(arrived.fields.get('metadata') ?? '{}') as {
      name?: string
      entrypoint_path?: string
      verify_jwt?: boolean
    }
    if (meta.name !== row.slug) problems.push('name differs')
    if (meta.entrypoint_path !== row.entrypoint) problems.push('entrypoint differs')
    if (meta.verify_jwt !== row.verify_jwt) problems.push('verify_jwt differs')
    if (arrived.files.length !== row.files.length)
      problems.push(
        `${String(arrived.files.length)} parts sent, ${String(row.files.length)} captured`,
      )
    const got = new Map(arrived.files.map((f) => [f.name, f]))
    for (const f of row.files) {
      const g = got.get(f.path)
      if (g === undefined) problems.push(`${f.path} not received`)
      else if (g.sha !== f.sha256 || g.bytes !== f.bytes) problems.push(`${f.path} arrived changed`)
    }
  }
  const files = new Map(
    row.files.map((f) => [f.path, readFileSync(join(dir, 'source', f.path), 'utf8')]),
  )
  // a captured bundle is the platform's own emitted JavaScript, so a relative import of ./x.ts must resolve inside it
  for (const c of closureProblems(files)) problems.push(`not closed: ${c}`)
  const bundle = readFileSync(join(dir, `${row.slug}.v${dir.split('.v')[1] ?? ''}.eszip`))
  if (sha(bundle) !== row.bundle_sha256)
    problems.push('the stored bundle no longer matches its recorded checksum')
  if (problems.length > 0) bad += 1
  console.log(
    `${problems.length === 0 ? 'ok  ' : 'FAIL'} ${d}: ${String(row.files.length)} file(s), entry ${row.entrypoint}, verify_jwt ${String(row.verify_jwt)}${problems.length > 0 ? `: ${problems.slice(0, 3).join('; ')}` : ''}`,
  )
}
server.close()
console.log(
  `${String(dirs.length - bad)} of ${String(dirs.length)} rehearsed against the isolated target`,
)
process.exit(bad === 0 ? 0 : 1)
