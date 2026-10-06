/**
 * The security-control mutation campaign (deep systems audit, second wave).
 *
 *   npx tsx scripts/audit/mutation-campaign.ts [--only=M1,M7] [--out=path.json]
 *
 * Breaks one control at a time in a THROWAWAY git worktree of the committed tree and runs the unit suite. A mutation is
 * CAUGHT only when the suite goes red; SURVIVED when it stays green; DID NOT LAND when its anchor is not present exactly
 * once (reported as that, never as a catch - a sabotage that did not apply proves nothing).
 *
 * Trustworthy baselines, by construction:
 *  - the worktree is a real git checkout, so tests that read `git ls-files` work (the earlier file-copy approach had no
 *    `.git` and one test failed in every run, which masqueraded as a catch);
 *  - the BASELINE is run first and the campaign refuses to continue unless it is green, so an infrastructure failure
 *    cannot be counted as a mutation caught;
 *  - the tree must be clean: the worktree is made from HEAD and an uncommitted change would be tested against nothing;
 *  - production credentials are removed from the child's environment.
 *
 * It contacts nothing outside this machine and writes nothing in the repository (the worktree is removed afterwards).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

interface Mutation {
  id: string
  critical: boolean
  severity: string
  file: string
  old: string
  new: string
  invariant: string
  expect: string
}

const root = resolve(import.meta.dirname, '../..')
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const only = arg('only')?.split(',')
const manifest = JSON.parse(readFileSync(join(root, 'scripts/audit/mutations.json'), 'utf8')) as {
  mutations: Mutation[]
}
const mutations = manifest.mutations.filter((m) => only === undefined || only.includes(m.id))

const git = (args: string[], cwd = root): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

if (git(['status', '--porcelain', '--untracked-files=no']) !== '') {
  console.error(
    'REFUSED: the working tree has uncommitted changes; commit them so the worktree tests them.',
  )
  process.exit(2)
}

const dir = join(mkdtempSync(join(tmpdir(), 'mutation-')), 'wt')
git(['worktree', 'add', '--detach', dir, 'HEAD'])
symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'))

const env: NodeJS.ProcessEnv = {}
for (const [k, v] of Object.entries(process.env)) {
  if (!/SUPABASE|ALLOW_PRODUCTION|HQ_API_TOKEN|HQ_MANAGEMENT_TOKEN/.test(k)) env[k] = v
}

const suite = (bail: boolean) => {
  const args = ['vitest', 'run', '--reporter=dot', ...(bail ? ['--bail=1'] : [])]
  const r = spawnSync('npx', args, { cwd: dir, env, encoding: 'utf8', timeout: 540_000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '')
  const failing = [...new Set([...out.matchAll(/FAIL\s+(tests\/\S+)/g)].map((m) => m[1] as string))]
  return { status: r.status, failing, tail: out.split('\n').slice(-6).join('\n') }
}

const results: Record<string, unknown>[] = []
try {
  console.log('baseline (must be green)...')
  const base = suite(false)
  if (base.status !== 0) {
    console.error(
      `REFUSED: the baseline is red (${base.failing.join(', ') || 'no failing file named'}).\n${base.tail}`,
    )
    process.exitCode = 3
  } else {
    console.log('baseline green')
    for (const m of mutations) {
      const path = join(dir, m.file)
      const original = readFileSync(path, 'utf8')
      const count = original.split(m.old).length - 1
      if (count !== 1) {
        console.log(`${m.id}: DID NOT LAND (anchor occurs ${String(count)} times)`)
        results.push({ ...m, result: 'DID_NOT_LAND', anchors: count })
        continue
      }
      writeFileSync(
        path,
        original.replace(m.old, () => m.new),
      )
      const landed = readFileSync(path, 'utf8') !== original
      let run: ReturnType<typeof suite> | undefined
      try {
        run = landed ? suite(true) : undefined
      } finally {
        writeFileSync(path, original)
      }
      const result = run === undefined ? 'DID_NOT_LAND' : run.status === 0 ? 'SURVIVED' : 'CAUGHT'
      const expected = run?.failing.some((f) => f.includes(m.expect)) ?? false
      console.log(
        `${m.id}: ${result}${run?.failing.length ? ` by ${run.failing.join(', ')}` : ''}${result === 'CAUGHT' && !expected ? ` (not by the expected test ${m.expect})` : ''}`,
      )
      results.push({ ...m, result, caughtBy: run?.failing ?? [], expectedTestCaught: expected })
    }
    // The tree is restored; prove it by running the baseline again.
    const after = suite(false)
    console.log(`restored baseline: ${after.status === 0 ? 'green' : 'RED'}`)
    results.push({ restoredBaselineGreen: after.status === 0 })
    const caught = results.filter((r) => r.result === 'CAUGHT').length
    const survived = results.filter((r) => r.result === 'SURVIVED').length
    const missed = results.filter((r) => r.result === 'DID_NOT_LAND').length
    console.log(
      `\ncaught ${String(caught)}, survived ${String(survived)}, did not land ${String(missed)} of ${String(mutations.length)}`,
    )
    if (survived > 0 || missed > 0) process.exitCode = 1
  }
} finally {
  const out = arg('out')
  if (out !== undefined) writeFileSync(out, JSON.stringify(results, null, 2))
  try {
    git(['worktree', 'remove', '--force', dir])
  } catch {
    rmSync(dir, { recursive: true, force: true })
  }
}
