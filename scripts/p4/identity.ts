/**
 * The controlled second person's IDENTITY, read-only: the address, the keys, and the names the acceptance harness uses to
 * sign in as the Sample Person. Split out of provision-second-person.ts so a read-only capture or suite can name the Sample
 * without loading the module that creates logins and offices (which is behind the production WRITE gate). This file only
 * reads: one GET of the project's API keys, guarded by the production READ gate.
 */
import '../../src/safety/require-production-checks.ts'

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
export const SECOND_EMAIL = 'p4-second-person@acceptance.agentic.invalid'
export const SECOND_KEY = 'p4-second-person'
export const SECOND_NAME = 'P4 second person (acceptance)'

export const apiKeys = async (): Promise<{ anon: string; service: string }> => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  const keys = (await r.json()) as { name: string; api_key: string }[]
  const anon = keys.find((k) => k.name === 'anon')?.api_key
  const service = keys.find((k) => k.name === 'service_role')?.api_key
  if (anon === undefined || service === undefined)
    throw new Error('could not read the project keys')
  return { anon, service }
}
