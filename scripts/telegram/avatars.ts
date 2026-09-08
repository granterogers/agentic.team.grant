/**
 * Give each staff bot that person's face.
 *
 *   npm run telegram:avatars
 *
 * Grant: *"see if you can assign profile picture too."*
 *
 * You can, and not by the obvious route. There is no `setBotProfilePhoto` —
 * that 404s — and `setChatPhoto` refuses because a bot's own profile is not a
 * chat. The method is `setMyProfilePhoto`, and it will not take a URL: the
 * photo is an `InputProfilePhoto` whose file must be uploaded as multipart,
 * with the JSON naming the part (`attach://pic`) and the part carrying the
 * bytes. Passing a URL string gets "can't parse photo JSON object", which
 * reads like a bug in the caller and is in fact the shape of the argument.
 *
 * Idempotent, so it is safe on every avatar change. Re-run it after generating
 * new avatars or renaming anyone.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)

const rows = (
  await db.execute(`
    select t.username, app.resolve_secret(t.token_ref) as token, s.name, s.avatar_ref,
           (select value #>> '{}' from public.system_config
             where key = 'staff.avatar_base_url') as base
      from public.telegram_bots t
      join public.staff s on s.slug = t.staff_slug
     where t.enabled and s.active and s.avatar_ref is not null
     order by s.name
  `)
).rows as { username: string; token: string; name: string; avatar_ref: string; base: string }[]

if (rows.length === 0) {
  console.log('no staff bot has an avatar to set.')
  process.exit(0)
}

let set = 0
for (const row of rows) {
  const url = `${row.base}/${row.avatar_ref}`
  const image = await fetch(url)
  if (!image.ok) {
    console.log(`${row.name.padEnd(8)} avatar not readable (http ${String(image.status)})`)
    continue
  }
  const form = new FormData()
  form.append('photo', JSON.stringify({ type: 'static', photo: 'attach://pic' }))
  // `Buffer.from`, not the raw ArrayBuffer: Node's File accepts a BinaryLike
  // and TypeScript is right to refuse the bare buffer.
  form.append(
    'pic',
    new File([Buffer.from(await image.arrayBuffer())], 'avatar.png', { type: 'image/png' }),
  )

  const result = (await (
    await fetch(`https://api.telegram.org/bot${row.token}/setMyProfilePhoto`, {
      method: 'POST',
      body: form,
    })
  ).json()) as { ok?: boolean; description?: string }

  if (result.ok === true) set += 1
  console.log(
    `${row.name.padEnd(8)} @${row.username.padEnd(20)} ` +
      `${result.ok === true ? 'photo set' : `refused: ${String(result.description)}`}`,
  )
}
console.log(`\n${String(set)} of ${String(rows.length)} bot(s) now wear their own face.`)
