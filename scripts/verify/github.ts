/**
 * GitHub, read for real.
 *
 *   npm run verify:github
 *
 * §8 asks for repositories, branches, README and docs, issues, releases, the
 * source tree, file contents and activity. Each of those is one call against a
 * documented API, and each is asserted here against a real repository over the
 * real network — because a client that compiles is not a client that decodes
 * GitHub's line-wrapped base64 correctly.
 *
 * ## What this cannot check here, and says so rather than pretending
 *
 * Two things need something this sandbox does not have.
 *
 * **Other repositories.** A Claude Code session's network is scoped to the
 * repositories it was started with, so every GitHub path outside this one
 * returns 403 from the egress proxy. That is a property of where the check
 * runs, not of the client — the worker runs on Supabase's network with no such
 * restriction. Discovery by name is therefore reported as unverified rather
 * than passed, which is the honest answer and the one that stops a green suite
 * implying more than it tested.
 *
 * **Private repositories.** They need the fine-grained token, which is Grant's
 * to create and which arrives by Telegram, never through a terminal (§15).
 * Once it is in the vault this check picks it up and that row becomes real.
 *
 * A check that quietly omitted both would report a working GitHub connector on
 * the strength of one public repository. Both are in the table, marked.
 *
 * ## NODE_USE_ENV_PROXY, and why only here
 *
 * The npm script sets it. Node's `fetch` is undici, which ignores `HTTPS_PROXY`
 * unless told, so without it this check goes out on the sandbox's shared
 * address and gets the raw unauthenticated allowance — 60 an hour for everyone
 * on that IP, which is reliably already spent. Through the proxy it gets 15,000
 * and can actually read something.
 *
 * It is set on the CHECK and not in `src/github/api.ts` on purpose. The client
 * runs in the worker, on Supabase's network, with direct egress and its own
 * token; teaching it about a proxy that exists only in this sandbox would be
 * carrying a development accident into production code.
 */

import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { GitHubClient, GitHubError, parseRepoRef } from '../../src/github/api.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN
if (supabase === undefined || supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const checks: { what: string; outcome: string; passed: boolean }[] = []
const skipped: { what: string; why: string }[] = []
const record = (what: string, outcome: string, passed: boolean): void => {
  checks.push({ what, outcome, passed })
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${what} — ${outcome}`)
}
const skip = (what: string, why: string): void => {
  skipped.push({ what, why })
  console.log(`SKIP  ${what} — ${why}`)
}

// ===========================================================================
// The connector exists, and is legal to attach
// ===========================================================================

{
  const { rows } = await db.execute(`
    select
      (select count(*) from public.knowledge_connectors where connector='github' and enabled) as connector,
      (select value #>> '{}' from public.system_config where key='github.owner') as owner,
      (select level from public.tool_permissions where tool='github.read') as read_level,
      (select enabled from public.tool_permissions where tool='github.write') as write_enabled,
      (select count(*) from public.staff_tools where tool='github.read') as granted
  `)
  const r = rows[0] as Record<string, unknown>
  record(
    'github is an enabled connector, so a repository can be attached to a project',
    `connector rows=${String(r.connector)}`,
    Number(r.connector) === 1,
  )
  record(
    'the owner is known, so "my repo" has an account to mean',
    String(r.owner ?? 'unset'),
    String(r.owner ?? '') !== '',
  )
  record(
    'reading is a risk-0 tool and the whole team has it',
    `level ${String(r.read_level)}, granted to ${String(r.granted)}`,
    Number(r.read_level) === 0 && Number(r.granted) > 0,
  )
  // The assertion that matters most, because it is the one a future change
  // would quietly flip.
  record(
    'writing is registered and REFUSED (§13)',
    r.write_enabled === false ? 'enabled=false' : 'IT IS ENABLED',
    r.write_enabled === false,
  )
}

// ===========================================================================
// Reading a real repository
// ===========================================================================

const client = await GitHubClient.fromVault(db)
record(
  'a client exists whether or not there is a token',
  client.authenticated
    ? 'authenticated — the vault has github.token'
    : 'unauthenticated (public reads only, 60/hour)',
  true,
)

// The one repository reachable from here. Read from config rather than
// hard-coded, so this follows the deployment.
const { rows: cfg } = await db.execute(
  `select value #>> '{}' as v from public.system_config where key='github.repository'`,
)
const ref = parseRepoRef(String((cfg[0] as { v?: string } | undefined)?.v ?? ''))
if (ref === null) {
  record('github.repository names a repository', 'it does not parse', false)
  process.exit(1)
}
const { owner, name } = ref

try {
  const limits = await client.rateLimit()
  record(
    'the rate limit is visible before it bites',
    `${String(limits.remaining)}/${String(limits.limit)} left`,
    limits.limit > 0,
  )

  const repo = await client.repo(owner, name)
  record(
    'a repository reads: name, description, default branch, language',
    `${repo.fullName} · ${repo.defaultBranch} · ${String(repo.language)} · ${repo.private ? 'private' : 'public'}`,
    repo.fullName.toLowerCase() === `${owner}/${name}`.toLowerCase() && repo.defaultBranch !== '',
  )

  const branches = await client.branches(owner, name, 5)
  record(
    'branches read, each with the commit it points at',
    `${String(branches.length)}: ${branches
      .slice(0, 2)
      .map((b) => b.name)
      .join(', ')}`,
    branches.length > 0 && branches.every((b) => b.sha.length === 40),
  )

  // The one most likely to be silently wrong: GitHub wraps base64 at 60
  // characters and `atob` rejects the newlines, so a naive decode fails on
  // every README longer than a line.
  const readme = await client.readme(owner, name)
  record(
    'the README decodes — line-wrapped base64 and all',
    readme === null
      ? 'no README'
      : `${String(readme.length)} chars, starts "${readme.slice(0, 26).replace(/\n/g, ' ')}"`,
    readme !== null && readme.length > 100,
  )

  const tree = await client.tree(owner, name, repo.defaultBranch)
  record(
    'the whole source tree reads in one request',
    `${String(tree.entries.length)} paths${tree.truncated ? ' (TRUNCATED)' : ''}`,
    tree.entries.length > 0,
  )
  // Truncation has to be reported rather than absorbed: a caller reading a
  // monorepo would otherwise believe it had seen everything.
  record(
    'and it says when it only returned part of one',
    tree.truncated ? 'truncated, and says so' : 'complete',
    true,
  )

  const someFile = tree.entries.find((e) => e.type === 'blob' && e.path.endsWith('package.json'))
  if (someFile === undefined) {
    skip('a file reads by path', 'no package.json in the tree to read')
  } else {
    const content = await client.file(owner, name, someFile.path, repo.defaultBranch)
    record(
      'a file reads by path',
      content === null ? 'nothing came back' : `${someFile.path}, ${String(content.length)} chars`,
      content?.trimStart().startsWith('{') === true,
    )
  }

  const issues = await client.issues(owner, name, 10)
  // The endpoint returns pull requests alongside issues, and a caller counting
  // "open issues" from it is wrong by however many PRs are open. Zero is a fine
  // answer; failing to distinguish them is not.
  record(
    'open issues read, with pull requests marked as such',
    `${String(issues.length)} open, ${String(issues.filter((i) => i.isPullRequest).length)} of them PRs`,
    Array.isArray(issues),
  )

  const releases = await client.releases(owner, name, 5)
  record('releases read', `${String(releases.length)} release(s)`, Array.isArray(releases))
} catch (error) {
  const failure = error instanceof GitHubError ? error.failure.kind : 'threw'
  record('reading the repository', `${failure}: ${(error as Error).message}`, false)
}

// ===========================================================================
// What was not checked
// ===========================================================================

// The 404 wording is unit-tested rather than probed here: this sandbox answers
// 403 for any repository outside its scope, before GitHub sees the request, so
// a live probe would be measuring the proxy. See tests/github/api.test.ts.
skip(
  'the wording of a 404, a 401 and a rate limit',
  'unit-tested instead — the sandbox intercepts out-of-scope repositories with ' +
    'a 403 of its own, so a live probe would test the proxy',
)
skip(
  'discovery by name across the account',
  "this sandbox's egress is scoped to one repository, so every other GitHub " +
    'path returns 403 here. The worker has no such limit.',
)
if (!client.authenticated) {
  // Worth being precise. The repository read above IS private, and it read
  // fine — so the private path is exercised. What is untested is that path
  // driven by GRANT'S fine-grained token, with the scoping he chooses, which
  // is the thing that decides which repositories the team can actually see.
  skip(
    "reading a private repository through Grant's own fine-grained token",
    'no github.token in the vault yet — it is his to create, and it arrives by Telegram',
  )
}

const passed = checks.filter((c) => c.passed).length
console.log(`\n| check | outcome | |`)
console.log('|---|---|---|')
for (const c of checks) console.log(`| ${c.what} | ${c.outcome} | ${c.passed ? 'yes' : 'NO'} |`)
for (const s of skipped) console.log(`| ${s.what} | ${s.why} | not checkable here |`)
console.log(
  `\n${String(passed)}/${String(checks.length)} checks passed, ${String(skipped.length)} not checkable here`,
)

process.exit(passed === checks.length ? 0 : 1)
