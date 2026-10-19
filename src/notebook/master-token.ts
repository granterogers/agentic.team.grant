/**
 * The durable credential the notebook reader mints from: the fields of the `master_token.json` the Windows token maker
 * produces, held in the vault as `notebook.master_token_json`.
 *
 * It lives in its own module so the HTTP read adapter and the HTTP action transport can both use it without importing
 * each other. Full-account, so it goes only to the reader, over TLS, for the life of one request, and is never logged
 * or echoed.
 */
export interface MasterToken {
  email: string
  android_id: string
  master_token: string
}

/** The vault's `notebook.master_token_json`, or null when it is absent or not a master token. */
export function masterTokenFrom(raw: string): MasterToken | null {
  if (raw === '') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (parsed === null || typeof parsed !== 'object') return null
  const { email, android_id, master_token } = parsed as Record<string, unknown>
  if (
    typeof email !== 'string' ||
    typeof android_id !== 'string' ||
    typeof master_token !== 'string' ||
    email === '' ||
    android_id === '' ||
    !master_token.startsWith('aas_et/')
  ) {
    return null
  }
  return { email, android_id, master_token }
}
