/**
 * Resolve a SESSION-pooler connection URI for `pg_dump`.
 *
 * Three facts make this necessary rather than just reading a secret:
 *
 * 1. `pg_dump` needs the Postgres wire protocol, so it can only run where
 *    egress is unrestricted — GitHub Actions, not a build session (ADR-0007).
 * 2. `SUPABASE_DB_URL` is the **direct** connection, whose host publishes AAAA
 *    records only. Supabase Free provides no IPv4 for it, and Actions runners
 *    have no IPv6, so `pg_dump` cannot dial it there either.
 * 3. The **transaction** pooler (port 6543) is not usable by `pg_dump`, which
 *    holds a session and relies on session-scoped state. Session mode, port
 *    5432 on the same host, is required.
 *
 * So: take the password from `SUPABASE_DB_URL`, take the host and user from the
 * Management API — authoritative, and self-correcting if Supabase moves the
 * project — and force port 5432.
 *
 * Asking Grant for a second connection string would have worked too, and would
 * have been the third time this project asked him for something derivable.
 *
 * Prints the URI on stdout. Callers must mask it; it contains the password.
 */
export interface PoolerConfig {
  readonly db_user: string
  readonly db_host: string
  readonly db_name: string
}

/** Session mode. Transaction mode (6543) breaks pg_dump. */
export const SESSION_POOLER_PORT = 5432

export function buildPoolerUri(directUrl: string, pooler: PoolerConfig): string {
  const direct = new URL(directUrl)
  const password = decodeURIComponent(direct.password)
  if (password === '') {
    throw new Error('SUPABASE_DB_URL carries no password; cannot derive a pooler URI')
  }

  // Built as a string with explicit encodeURIComponent rather than through
  // `URL`'s username/password setters.
  //
  // Those setters apply the WHATWG "userinfo percent-encode set", which does
  // NOT include `%`. So a password containing a literal `%` survives into the
  // URI unescaped, and libpq — which percent-decodes the userinfo — then reads
  // `%&=` as a malformed escape. The failure surfaces as authentication being
  // refused with an entirely correct password, from a nightly job, which is
  // about the worst place to debug it.
  //
  // encodeURIComponent escapes `%` to `%25` and every other reserved
  // character, which is exactly what libpq expects to decode.
  const user = encodeURIComponent(pooler.db_user)
  const secret = encodeURIComponent(password)
  const database = encodeURIComponent(pooler.db_name)

  // sslmode=require encrypts without verifying the peer certificate.
  // Supabase's pooler presents a certificate that does not chain to a public
  // CA, so `verify-full` needs their CA pinned — a Phase 2 job alongside the
  // rest of the connection configuration. Stated here because silently
  // downgrading TLS is how a backup pipeline ends up shipping a database in
  // plaintext, and `require` at least is not that.
  return (
    `postgresql://${user}:${secret}@${pooler.db_host}:${SESSION_POOLER_PORT}` +
    `/${database}?sslmode=require`
  )
}

export async function fetchPoolerConfig(
  projectRef: string,
  accessToken: string,
): Promise<PoolerConfig> {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${projectRef}/config/database/pooler`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  )
  if (!response.ok) {
    throw new Error(`pooler config request failed: ${response.status} ${await response.text()}`)
  }
  const payload: unknown = await response.json()
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('pooler config response was empty')
  }
  const primary =
    payload.find((p: unknown) => (p as { database_type?: string }).database_type === 'PRIMARY') ??
    payload[0]
  const { db_user, db_host, db_name } = primary as Partial<PoolerConfig>
  if (typeof db_user !== 'string' || typeof db_host !== 'string' || typeof db_name !== 'string') {
    throw new Error('pooler config response was missing db_user, db_host or db_name')
  }
  return { db_user, db_host, db_name }
}
