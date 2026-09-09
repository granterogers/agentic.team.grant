/**
 * Reading GitHub.
 *
 * Grant, §8: *"GitHub should be a first-class connector"* — public repositories
 * by name or URL, private ones through an authenticated connection, and once
 * his identity is known, *"Look at my Rest Timer GitHub repo"* should resolve
 * without a URL.
 *
 * The audit found GitHub was not a connector at all. It was one string in
 * `system_config` — `github.repository`, pointing at this system's own repo —
 * and `project_attachments.connector` is a foreign key to
 * `knowledge_connectors`, so GitHub could not legally be attached to anything.
 * 0157 adds the row; this file is what reads through it.
 *
 * ## Why a hand-written client
 *
 * Octokit is large, and every operation here is one authenticated GET against
 * a documented, stable REST API. What this actually needs is the part a library
 * would hide: honest handling of the three answers GitHub gives that are not
 * "here is your data" — 404 for both "no such repo" and "no access", 403 for
 * rate limiting, and 401 for a token that has expired or been revoked. Those
 * have to reach Grant as different sentences, because they need different
 * things from him.
 *
 * ## Authentication is optional, and the difference is stark
 *
 * With no token this reads public repositories at **60 requests an hour, per
 * IP**, shared with everything else on that address. With a fine-grained token
 * it reads whatever the token was scoped to at **5,000 an hour**. So the
 * unauthenticated path is a real fallback rather than a mode anybody should
 * run in, and `rateLimit()` exists so the difference is visible rather than
 * discovered when something stops working at eleven in the morning.
 *
 * ## Read only, on purpose
 *
 * There is no method here that writes. §13 puts destructive GitHub operations
 * in the highest tier and 0157 registers `github.write` as risk 3, disabled.
 * Adding a write method later means adding it to a file that currently has a
 * simple, checkable property: nothing in it can change anything.
 */

import type { SqlExecutor } from '../db/executor.ts'

const API = 'https://api.github.com'

/** Everything the callers below need to tell Grant what went wrong. */
export type GitHubFailure =
  | { readonly kind: 'not_found' }
  | { readonly kind: 'rate_limited'; readonly resetsAt: Date | null }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'unavailable'; readonly detail: string }

export class GitHubError extends Error {
  constructor(
    readonly failure: GitHubFailure,
    message: string,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

export interface Repo {
  readonly owner: string
  readonly name: string
  readonly fullName: string
  readonly description: string | null
  readonly private: boolean
  readonly defaultBranch: string
  readonly language: string | null
  readonly topics: readonly string[]
  readonly pushedAt: string | null
  readonly htmlUrl: string
}

export interface Branch {
  readonly name: string
  readonly sha: string
}

export interface Issue {
  readonly number: number
  readonly title: string
  readonly state: string
  readonly isPullRequest: boolean
  readonly updatedAt: string
  readonly htmlUrl: string
}

export interface Release {
  readonly tag: string
  readonly name: string | null
  readonly publishedAt: string | null
  readonly htmlUrl: string
}

export interface TreeEntry {
  readonly path: string
  readonly type: 'blob' | 'tree'
  readonly size: number | null
}

export interface Limits {
  readonly limit: number
  readonly remaining: number
  readonly resetsAt: Date
  readonly authenticated: boolean
}

/**
 * `owner/name` out of whatever Grant pasted.
 *
 * A URL, an `owner/name`, an SSH remote, or any of those with a branch or a
 * file path hanging off the end — all of which arrive in practice, because the
 * URL in the address bar while you are reading a file is not the URL of the
 * repository. Returns null rather than guessing.
 */
export const parseRepoRef = (text: string): { owner: string; name: string } | null => {
  const cleaned = text.trim()
  const patterns = [
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/#?].*)?$/i,
    /^([\w-]+)\/([\w.-]+?)(?:\.git)?$/,
  ]
  for (const pattern of patterns) {
    const found = pattern.exec(cleaned)
    // A trailing dot is legal in a URL path and never in a repository name.
    if (found?.[1] !== undefined && found[2] !== undefined) {
      return { owner: found[1], name: found[2].replace(/\.+$/, '') }
    }
  }
  return null
}

export class GitHubClient {
  private constructor(private readonly token: string | null) {}

  /**
   * A client, authenticated if the vault holds anything that can authenticate.
   *
   * ## Why this is a list and not a name
   *
   * The first version asked for `github.token`, found nothing, and reported
   * "no token — it is Grant's to create". A GitHub token had been in the vault
   * for days as `github.dispatch_token`. His reply: *"I already gave you a
   * token ages ago.. you need to bake this in so you don't forget again."*
   *
   * A single hard-coded name turns "we have no credential" into a claim about
   * one guess. The order below is preference, and `usingSecret` reports which
   * one answered, so the claim is always checkable. 0159 adds
   * `app.vault_inventory()` for the same reason at the system level.
   *
   * ## Why a write-scoped token is acceptable here
   *
   * `github.dispatch_token` carries contents:write on one repository, and using
   * it for reads looks like a least-privilege violation. It is not, quite:
   * nothing in this file writes, so the client cannot exercise that scope, and
   * `github.write` is registered at risk 3 and disabled (0157). Reporting no
   * credential when one exists is the worse failure, and it is the one that
   * actually happened. If a write method is ever added here, this fallback has
   * to go first.
   *
   * Never null: an unauthenticated client can still read public repositories,
   * and "GitHub is unavailable" is a much stronger claim than "we have no
   * token". `authenticated` says which one this is, so a caller explaining a
   * 404 can say whether a private repository was even possible.
   */
  static readonly SECRET_NAMES = [
    // Purpose-made for §8: read-only, scoped to the repositories Grant picks.
    'github.read_token',
    'github.token',
    // Made for repository_dispatch (0126) and scoped to this repository only.
    // It authenticates, so it beats nothing; it cannot see any other repo.
    'github.dispatch_token',
  ] as const

  private static resolvedFrom: string | null = null

  static async fromVault(db: SqlExecutor): Promise<GitHubClient> {
    const names = GitHubClient.SECRET_NAMES.map((n) => `'${n}'`).join(', ')
    const { rows } = await db.execute(`
      select name, decrypted_secret as t
        from vault.decrypted_secrets
       where name in (${names})
    `)
    const held = new Map(
      (rows as { name: string; t: string }[]).map((r) => [String(r.name), String(r.t)]),
    )
    for (const name of GitHubClient.SECRET_NAMES) {
      const token = held.get(name)
      if (token !== undefined && token !== '') {
        GitHubClient.resolvedFrom = name
        return new GitHubClient(token)
      }
    }
    GitHubClient.resolvedFrom = null
    return new GitHubClient(null)
  }

  /** Which vault secret the last `fromVault` used, so a report can say so. */
  static get usingSecret(): string | null {
    return GitHubClient.resolvedFrom
  }

  /** For tests and for the one-off scripts. */
  static withToken(token: string | null): GitHubClient {
    return new GitHubClient(token === null || token === '' ? null : token)
  }

  get authenticated(): boolean {
    return this.token !== null
  }

  private async get(path: string): Promise<{ body: unknown; headers: Headers }> {
    let response: Response
    try {
      response = await fetch(`${API}/${path}`, {
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          // Required by GitHub, and it should say who this is rather than
          // pretending to be a browser.
          'User-Agent': 'ai-team-hq',
          ...(this.token === null ? {} : { Authorization: `Bearer ${this.token}` }),
        },
      })
    } catch (error) {
      throw new GitHubError(
        { kind: 'unavailable', detail: (error as Error).message },
        `GitHub could not be reached: ${(error as Error).message}`,
      )
    }

    if (response.ok) return { body: await response.json(), headers: response.headers }

    // 403 with the remaining count at zero is a rate limit; 403 for any other
    // reason is a permission problem and must not be reported as "try again in
    // an hour", which would be advice that never comes true.
    const remaining = response.headers.get('x-ratelimit-remaining')
    if ((response.status === 403 || response.status === 429) && remaining === '0') {
      const reset = response.headers.get('x-ratelimit-reset')
      const resetsAt = reset === null ? null : new Date(Number(reset) * 1000)
      throw new GitHubError(
        { kind: 'rate_limited', resetsAt },
        this.token === null
          ? 'GitHub is rate limiting us. Unauthenticated reads get 60 an hour, ' +
              'shared across everything on this address — a token raises it to 5,000.'
          : 'GitHub is rate limiting us, which at 5,000 an hour means something ' +
              'is looping. Worth looking at before asking for more.',
      )
    }
    if (response.status === 401) {
      throw new GitHubError(
        { kind: 'unauthorized' },
        'GitHub rejected the token. Fine-grained tokens expire, and they stop ' +
          'working immediately if the repository access is changed.',
      )
    }
    if (response.status === 404) {
      // The single most confusing answer GitHub gives, so it is explained
      // rather than passed through: a private repository is a 404 to anyone
      // who cannot see it, identical to one that does not exist.
      throw new GitHubError(
        { kind: 'not_found' },
        this.token === null
          ? 'No such repository — or it is private, which looks exactly the ' +
              'same from here because we have no token.'
          : 'No such repository — or the token was not given access to it.',
      )
    }
    throw new GitHubError(
      { kind: 'unavailable', detail: `http ${String(response.status)}` },
      `GitHub returned ${String(response.status)}.`,
    )
  }

  /** What GitHub will let us do, and for how long. */
  async rateLimit(): Promise<Limits> {
    const { body } = await this.get('rate_limit')
    const core = (body as { resources?: { core?: Record<string, number> } }).resources?.core ?? {}
    return {
      limit: Number(core.limit ?? 0),
      remaining: Number(core.remaining ?? 0),
      resetsAt: new Date(Number(core.reset ?? 0) * 1000),
      authenticated: this.authenticated,
    }
  }

  async repo(owner: string, name: string): Promise<Repo> {
    const { body } = await this.get(`repos/${owner}/${name}`)
    const r = body as Record<string, unknown>
    return {
      owner: String((r.owner as { login?: string })?.login ?? owner),
      name: String(r.name ?? name),
      fullName: String(r.full_name ?? `${owner}/${name}`),
      description: r.description === null ? null : String(r.description),
      private: r.private === true,
      defaultBranch: String(r.default_branch ?? 'main'),
      language: r.language === null || r.language === undefined ? null : String(r.language),
      topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
      pushedAt: r.pushed_at === null || r.pushed_at === undefined ? null : String(r.pushed_at),
      htmlUrl: String(r.html_url ?? `https://github.com/${owner}/${name}`),
    }
  }

  async branches(owner: string, name: string, limit = 30): Promise<Branch[]> {
    const { body } = await this.get(`repos/${owner}/${name}/branches?per_page=${String(limit)}`)
    return (body as { name: string; commit?: { sha?: string } }[]).map((b) => ({
      name: String(b.name),
      sha: String(b.commit?.sha ?? ''),
    }))
  }

  /**
   * The README, decoded.
   *
   * Null when there is not one, which is a fact about the repository rather
   * than an error — plenty of working repositories have no README, and a
   * throw here would make "no README" indistinguishable from "no access".
   */
  async readme(owner: string, name: string): Promise<string | null> {
    try {
      const { body } = await this.get(`repos/${owner}/${name}/readme`)
      const content = String((body as { content?: string }).content ?? '')
      return content === '' ? null : decodeBase64(content)
    } catch (error) {
      if (error instanceof GitHubError && error.failure.kind === 'not_found') return null
      throw error
    }
  }

  /**
   * Every path in the tree at a ref, in one request.
   *
   * `recursive=1`, because walking a source tree directory by directory is how
   * a 60-an-hour budget disappears. GitHub truncates very large trees and says
   * so; the flag is passed through rather than hidden, so a caller reading a
   * monorepo knows it is looking at part of one.
   */
  async tree(
    owner: string,
    name: string,
    ref: string,
  ): Promise<{ entries: TreeEntry[]; truncated: boolean }> {
    const { body } = await this.get(`repos/${owner}/${name}/git/trees/${ref}?recursive=1`)
    const t = body as { tree?: Record<string, unknown>[]; truncated?: boolean }
    return {
      entries: (t.tree ?? []).map((e) => ({
        path: String(e.path),
        type: e.type === 'tree' ? 'tree' : 'blob',
        size: e.size === undefined ? null : Number(e.size),
      })),
      truncated: t.truncated === true,
    }
  }

  /**
   * One file's contents.
   *
   * Refuses anything over a megabyte rather than returning half of it: the
   * contents API silently omits the body above that size, and a caller handed
   * an empty string would read it as an empty file.
   */
  async file(owner: string, name: string, path: string, ref?: string): Promise<string | null> {
    const query = ref === undefined ? '' : `?ref=${encodeURIComponent(ref)}`
    const { body } = await this.get(
      `repos/${owner}/${name}/contents/${path.split('/').map(encodeURIComponent).join('/')}${query}`,
    )
    const f = body as { content?: string; size?: number; encoding?: string; type?: string }
    if (f.type !== 'file') return null
    if (f.encoding !== 'base64' || f.content === undefined) return null
    return decodeBase64(f.content)
  }

  async issues(owner: string, name: string, limit = 20): Promise<Issue[]> {
    const { body } = await this.get(
      `repos/${owner}/${name}/issues?state=open&per_page=${String(limit)}&sort=updated`,
    )
    return (body as Record<string, unknown>[]).map((i) => ({
      number: Number(i.number),
      title: String(i.title),
      state: String(i.state),
      // The issues endpoint returns pull requests too, and a caller counting
      // "open issues" from it will be wrong by however many PRs are open.
      isPullRequest: i.pull_request !== undefined,
      updatedAt: String(i.updated_at),
      htmlUrl: String(i.html_url),
    }))
  }

  async releases(owner: string, name: string, limit = 10): Promise<Release[]> {
    const { body } = await this.get(`repos/${owner}/${name}/releases?per_page=${String(limit)}`)
    return (body as Record<string, unknown>[]).map((r) => ({
      tag: String(r.tag_name),
      name: r.name === null || r.name === undefined ? null : String(r.name),
      publishedAt:
        r.published_at === null || r.published_at === undefined ? null : String(r.published_at),
      htmlUrl: String(r.html_url),
    }))
  }

  /** Repositories an owner has, newest activity first. Needs a token for private ones. */
  async repos(owner: string, limit = 100): Promise<Repo[]> {
    // `/user/repos` when the token IS this owner, because that is the only
    // route that returns private repositories. `/users/{owner}/repos` returns
    // public ones for anybody, token or not.
    const path = this.authenticated
      ? `user/repos?per_page=${String(limit)}&sort=pushed&affiliation=owner,collaborator,organization_member`
      : `users/${owner}/repos?per_page=${String(limit)}&sort=pushed`
    const { body } = await this.get(path)
    return (body as Record<string, unknown>[]).map((r) => ({
      owner: String((r.owner as { login?: string })?.login ?? owner),
      name: String(r.name),
      fullName: String(r.full_name),
      description: r.description === null ? null : String(r.description),
      private: r.private === true,
      defaultBranch: String(r.default_branch ?? 'main'),
      language: r.language === null || r.language === undefined ? null : String(r.language),
      topics: Array.isArray(r.topics) ? (r.topics as string[]) : [],
      pushedAt: r.pushed_at === null || r.pushed_at === undefined ? null : String(r.pushed_at),
      htmlUrl: String(r.html_url),
    }))
  }
}

/**
 * GitHub's base64, which has newlines in it.
 *
 * `atob` rejects them, and the contents API wraps at 60 characters, so a naive
 * decode fails on every file over that length — including most READMEs.
 */
const decodeBase64 = (encoded: string): string => {
  const binary = atob(encoded.replace(/\s+/g, ''))
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}
