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
 *
 * ## The pager bot has a face too
 *
 * Grant: *"chief of staff needs a photo too"* — and she had none, because the
 * pager bot deliberately belongs to nobody. `hq_bot_assign` refuses to give it
 * an owner (0131) and is right to: every notification path assumes the pager
 * exists and is unowned, and the routing rule added in 0136 reads a null
 * `staff_slug` as "this is the voice that may interrupt Grant".
 *
 * A face is not ownership. The pager speaks as the Chief of Staff, so it wears
 * her face, and the roster row stays exactly as it was.
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
    with base as (
      select value #>> '{}' as url from public.system_config
       where key = 'staff.avatar_base_url'
    )
    -- The bots somebody owns.
    select t.username, app.resolve_secret(t.token_ref) as token, s.name,
           s.avatar_ref, (select url from base) as base
      from public.telegram_bots t
      join public.staff s on s.slug = t.staff_slug
     where t.enabled and s.active and s.avatar_ref is not null
    union all
    -- And the pager, which owns nobody and speaks as the Chief of Staff.
    select t.username, app.resolve_secret(t.token_ref) as token, s.name,
           s.avatar_ref, (select url from base) as base
      from public.telegram_bots t
      cross join public.staff s
     where t.enabled and t.is_pager and t.staff_slug is null
       and s.slug = 'chief-of-staff' and s.active and s.avatar_ref is not null
     order by 3
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
