/**
 * Identifiers the fresh-install harness must never touch.
 *
 * §16 of the master prompt: "explicit refusal of production identifiers ...
 * refuse known Grant production resource IDs ... Never delete Grant's data,
 * bots, Slack app, deployments, Supabase project, buckets or provider keys."
 *
 * ## Why a list of real identifiers lives in the repository
 *
 * It reads like the opposite of removing Grant-specific values from the code,
 * and it is the reverse: everywhere else a Grant identifier is a DEFAULT that
 * something will silently use. Here it is a DENY list that something will
 * loudly refuse. The project ref below is not a credential — it is in 252 files
 * already, and it is the public half of a URL. What makes it dangerous is being
 * a fallback, and what makes it safe is being a tripwire.
 *
 * ## Why this is not a pattern
 *
 * CLAUDE.md's rule is to "assert the property, never the artefact" — and it has
 * a counterpart that applies here: "a whitelist of permitted values fails by
 * refusing to speak, which is the expensive direction." This is a BLACK list,
 * where the cheap direction is the other one: an over-broad refusal costs a
 * harness run, an under-broad one costs Grant's production database. So it
 * names what is known AND checks the structural property (is this host local),
 * and a caller must satisfy both.
 */

/**
 * Grant's production Supabase project reference.
 *
 * Not a secret: it is the public subdomain of the project's API URL and appears
 * in 252 files in this repository as a hard-coded default. It is here so that
 * anything in the fresh-install path can refuse it by name.
 */
export const GRANT_PRODUCTION_PROJECT_REF = 'baujwlzcziasnfhhkchg'

/** Hosts a disposable harness database may live on. */
export const LOCAL_HOSTS: readonly string[] = ['localhost', '127.0.0.1', '::1', '0.0.0.0']

/**
 * Every database the harness creates starts with this. A reset that cannot name
 * what it created can only guess, and a guess is how a sweep reaches something
 * real — so the harness deletes ONLY names matching this prefix.
 */
export const HARNESS_DB_PREFIX = 'fresh_alex_'

/** Project/organisation slugs a fresh-install fixture may use. */
export const HARNESS_NAMESPACE = 'fresh-alex-'

export class ProductionIdentifierError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProductionIdentifierError'
  }
}

/**
 * Refuse anything naming Grant's production project.
 *
 * @param what Where the value came from, so the message says what to change.
 */
export function refuseProductionRef(value: string | undefined, what: string): void {
  if (value === undefined) return
  if (value.includes(GRANT_PRODUCTION_PROJECT_REF)) {
    throw new ProductionIdentifierError(
      `${what} names Grant's production Supabase project. The fresh-install harness ` +
        'refuses it by design: this harness creates, migrates and DELETES databases, ' +
        'and the one thing it must never do is any of that to a real one. ' +
        'Point it at a disposable database instead.',
    )
  }
}

/** Refuse a database name the harness did not create. */
export function refuseForeignDatabase(name: string): void {
  if (!name.startsWith(HARNESS_DB_PREFIX)) {
    throw new ProductionIdentifierError(
      `refusing to operate on database "${name}": the fresh-install harness only ` +
        `creates and destroys databases named ${HARNESS_DB_PREFIX}*. A database it ` +
        'did not create is a database somebody else is using.',
    )
  }
}

/** Refuse a connection string that does not point at this machine. */
export function refuseRemoteHost(connectionString: string, what: string): void {
  if (!connectionString.includes('://')) return // a local socket
  let host: string
  try {
    host = new URL(connectionString).hostname
  } catch {
    throw new ProductionIdentifierError(`${what} is not a connection string this harness can read`)
  }
  if (!LOCAL_HOSTS.includes(host)) {
    // Never echo the connection string: it carries a password.
    throw new ProductionIdentifierError(
      `${what} points at "${host}", which is not this machine. The fresh-install ` +
        'harness drops and recreates databases; it runs against loopback only.',
    )
  }
}
