/**
 * Every staff member says hello, in their own voice, from their own bot.
 *
 *   npm run telegram:rollcall
 *
 * Grant asked for a message from everyone, and for messages generally to be
 * *"more human and easier to read"*. This is both at once: it exercises the
 * real path — the persona from `staff`, the same readability rules the reply
 * prompt now carries, each person's own bot and avatar — so what arrives is
 * what an ordinary reply will look like, not a hand-written impression of one.
 *
 * Deliberately NOT hand-written text per person. A hand-written hello would
 * prove the delivery works and nothing about the voice, which is the half he
 * actually asked about.
 */
import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { ProviderRouter } from '../../src/providers/router.ts'

const supabase = process.env.SUPABASE_ACCESS_TOKEN ?? ''
if (supabase === '') {
  console.error('SUPABASE_ACCESS_TOKEN is required')
  process.exit(2)
}
const db = new ManagementApiExecutor(
  process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg',
  supabase,
)
const router = new ProviderRouter(db, process.env.OPENROUTER_API_KEY ?? '')

const people = (
  await db.execute(`
    select s.slug, s.name, s.title, s.responsibilities, s.communication_style,
           array_to_string(s.expertise, ', ') as skills,
           t.username, app.resolve_secret(t.token_ref) as token, c.chat_id
      from public.staff s
      join public.telegram_bots t on t.staff_slug = s.slug and t.enabled
      join public.telegram_chats c on c.bot_id = t.bot_id
     where s.active
     order by case s.slug when 'chief-of-staff' then 0 else 1 end, s.name
  `)
).rows as {
  slug: string
  name: string
  title: string
  responsibilities: string | null
  communication_style: string | null
  skills: string | null
  username: string
  token: string
  chat_id: string
}[]

if (people.length === 0) {
  console.error('nobody has both a bot and a chat with Grant')
  process.exit(1)
}

let sent = 0
for (const p of people) {
  // The same shape the instruction handler uses, including the readability
  // rules added today — so this is a fair sample of an ordinary reply.
  const system =
    `You are ${p.name}, ${p.title} on a small team. ` +
    (p.responsibilities === null ? '' : `Your remit: ${p.responsibilities} `) +
    (p.communication_style === null ? '' : `How you talk: ${p.communication_style} `) +
    (p.skills === null || p.skills === '' ? '' : `What you are good at: ${p.skills}. `) +
    'You are messaging Grant, who runs the place, in a private chat. He is a ' +
    'colleague you know well, not a customer.\n\n' +
    'Write like a person messaging a person. Use contractions. Have an opinion ' +
    'where you have one.\n\n' +
    'Make it EASY TO READ on a phone. Short sentences. Two or three short ' +
    'paragraphs with a blank line between them, one thought each. A single ' +
    'dense block is a message he will skim and misread. Under 80 words, first ' +
    'person, no bullet points, no headings, no bold.\n\n' +
    'Never write: "I hope this helps", "Let me know if", "Certainly", "As an ' +
    'AI", "Here is a summary of". Do not sign your name — the chat shows who ' +
    'you are. Do not thank him.'

  const user =
    'Say hello properly, for the first time since the system went live. Tell ' +
    'him in your own words what YOU specifically are here to do and what he ' +
    'should send you rather than someone else. One concrete example of a thing ' +
    'he could ask you. Nothing generic — if this message could have been ' +
    'written by any of your colleagues, it is the wrong message.'

  let body: string
  try {
    const completion = await router.complete({
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      maxTokens: 2_000,
    })
    body = completion.content.trim()
  } catch (error) {
    console.log(`${p.name.padEnd(8)} could not write: ${(error as Error).message.slice(0, 90)}`)
    continue
  }
  if (body === '') {
    console.log(`${p.name.padEnd(8)} wrote nothing`)
    continue
  }

  const result = (await (
    await fetch(`https://api.telegram.org/bot${p.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: p.chat_id, text: body }),
    })
  ).json()) as { ok?: boolean; description?: string }

  if (result.ok === true) sent += 1
  console.log(
    `${p.name.padEnd(8)} @${p.username.padEnd(20)} ` +
      `${result.ok === true ? `sent (${String(body.length)} chars)` : `failed: ${String(result.description)}`}`,
  )
}
console.log(`\n${String(sent)} of ${String(people.length)} said hello.`)
