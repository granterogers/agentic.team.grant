/**
 * Provision the controlled second PERSON for P4 acceptance. Contacts nobody: the auth user is created through the admin
 * API with the address already confirmed, so no mail is sent, and the address is on a reserved domain nothing delivers to.
 *
 *   npx tsx scripts/p4/provision-second-person.ts            # report only
 *   npx tsx scripts/p4/provision-second-person.ts --go       # create the login (once) and the office
 *   npx tsx scripts/p4/provision-second-person.ts --retire   # disable the office (never a delete)
 *
 * The password is generated here, stored in the Vault as `p4.second_person.password` and never printed. The service key is
 * read from the Management API and never printed either.
 */
import '../../src/safety/require-production-writes.ts'
import { randomBytes } from 'node:crypto'
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { apiKeys, SECOND_EMAIL, SECOND_KEY, SECOND_NAME } from './identity.ts'

// The identity lives in identity.ts (read-only); re-exported so existing importers keep working.
export { apiKeys, SECOND_EMAIL, SECOND_KEY, SECOND_NAME }

const REF = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const db = new ManagementApiExecutor(REF, TOKEN)

if (import.meta.url === `file://${process.argv[1]}`) {
  const go = process.argv.includes('--go')
  const retire = process.argv.includes('--retire')
  const rows = (
    await db.execute(`
      select o.office_id::text, o.kind, o.state, o.auth_user_id::text as auth_user_id
        from public.offices o order by o.created_at`)
  ).rows as Record<string, string>[]
  console.log('offices before:')
  for (const o of rows)
    console.log(
      `  ${o.kind} ${o.state} office=${o.office_id} auth=${String(o.auth_user_id).slice(0, 8)}`,
    )
  const existing = (
    await db.execute(
      `select u.id::text as id from auth.users u where lower(u.email) = '${SECOND_EMAIL}'`,
    )
  ).rows[0] as { id?: string } | undefined

  if (retire) {
    const o = (
      await db.execute(
        `select o.office_id::text as id from public.offices o join auth.users u on u.id = o.auth_user_id where lower(u.email) = '${SECOND_EMAIL}'`,
      )
    ).rows[0] as { id?: string } | undefined
    if (o?.id === undefined) throw new Error('the second person has no office')
    console.log(
      JSON.stringify(
        (await db.execute(`select app.retire_person_office('${o.id}'::uuid) as r`)).rows[0],
      ),
    )
    process.exit(0)
  }
  if (!go) {
    console.log(
      `second person login exists: ${String(existing?.id !== undefined)}; run with --go to create`,
    )
    process.exit(0)
  }

  const { service } = await apiKeys()
  let authId = existing?.id
  if (authId === undefined) {
    const password = randomBytes(24).toString('base64url')
    const made = await fetch(`https://${REF}.supabase.co/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        apikey: service,
        Authorization: `Bearer ${service}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        email: SECOND_EMAIL,
        password,
        email_confirm: true,
        user_metadata: { purpose: 'p4-second-user-acceptance', controlled: true },
      }),
    })
    const body = (await made.json()) as { id?: string; msg?: string; message?: string }
    if (!made.ok || body.id === undefined) {
      throw new Error(
        `the login was not created: http ${String(made.status)} ${body.msg ?? body.message ?? ''}`,
      )
    }
    authId = body.id
    await db.execute(
      `select vault.create_secret('${password}', 'p4.second_person.password', 'P4 acceptance login; retire with the office')`,
    )
    console.log(
      'login created; its password is in the Vault as p4.second_person.password (not printed)',
    )
  }
  const done = (
    await db.execute(
      `select app.provision_person_office('${SECOND_NAME}', '${SECOND_EMAIL}', '${SECOND_KEY}') as r`,
    )
  ).rows[0] as { r: unknown }
  console.log(`provisioned: ${JSON.stringify(done.r)}`)
}
