/**
 * Mint a short-lived session for the TEST office's login (verify.operator) so a live check can drive the deployed
 * gateway as a signed-in member. Never mints for a person office. Prints the access token to stdout only.
 */
const ref = 'baujwlzcziasnfhhkchg'
const url = `https://${ref}.supabase.co`
const service = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const keys = (await (
  await fetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN ?? ''}` },
  })
).json()) as { name: string; api_key: string }[]
const anon = keys.find((k) => k.name === 'anon')?.api_key ?? ''
const email = 'verify.operator@example.com'
const link = await fetch(`${url}/auth/v1/admin/generate_link`, {
  method: 'POST',
  headers: {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify({ type: 'magiclink', email }),
})
if (!link.ok) throw new Error(`generate_link ${String(link.status)}`)
const { hashed_token } = (await link.json()) as { hashed_token?: string }
const v = await fetch(`${url}/auth/v1/verify`, {
  method: 'POST',
  headers: { apikey: anon, 'content-type': 'application/json' },
  body: JSON.stringify({ type: 'magiclink', token_hash: hashed_token }),
})
if (!v.ok) throw new Error(`verify ${String(v.status)}`)
const { access_token } = (await v.json()) as { access_token?: string }
process.stdout.write(access_token ?? '')

export {}
