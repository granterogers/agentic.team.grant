import { ManagementApiExecutor } from '../../src/db/executor.ts'
import { harnessSession } from './lib/harness-session.ts'
import { testOrigins } from './lib/test-origin.ts'

const ref = process.env.SUPABASE_PROJECT_REF ?? 'baujwlzcziasnfhhkchg'
const token = process.env.SUPABASE_ACCESS_TOKEN ?? ''
const db = new ManagementApiExecutor(ref, token)
const base = `https://${ref}.supabase.co`
const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const one = async (sql: string) => (await db.execute(sql)).rows[0] as Record<string, unknown>
void (await harnessSession(db, ref))
const origins = await testOrigins(db, 'verify:zz-mix-live')
const GRANT = String((await one(`select actor from public.subject_identities where origin_channel = 'telegram' and subject = 'grant' limit 1`)).actor)
const webhookSecret = String((await one(`select decrypted_secret as v from vault.decrypted_secrets where name = 'telegram.webhook_secret'`)).v)
let seq = Math.floor(Date.now() / 1000) % 1_000_000_000
for (const text of [
  'Research the venue options then draft a summary for me, and from now on keep everything short, and what did we decide about the date?',
  'From now on give me the conclusion first. Also remind me tomorrow to call Kevin. And what is the status of the venue?',
]) {
  const chat = origins.telegramChat()
  await origins.declare('telegram', chat)
  seq += 1
  await fetch(`${base}/functions/v1/telegram-webhook`, {
    method: 'POST',
    headers: { 'X-Telegram-Bot-Api-Secret-Token': webhookSecret, 'Content-Type': 'application/json' },
    body: JSON.stringify({ update_id: seq, message: { message_id: seq, date: Math.floor(Date.now() / 1000), text, chat: { id: Number(chat), type: 'supergroup' }, from: { id: Number(GRANT), first_name: 'Grant' } } }),
  })
  await new Promise((r) => setTimeout(r, 2500))
  const row = await one(`select job_id::text as job from public.inbound_commands where origin_channel = 'telegram' and origin_ref like ${lit(`${chat}:%`)} order by received_at desc limit 1`)
  const job = String(row.job)
  let state = ''
  for (let i = 0; i < 40; i++) {
    state = String((await one(`select state::text as s from public.jobs where job_id = ${lit(job)}::uuid`)).s)
    if (['complete', 'failed', 'cancelled', 'paused'].includes(state)) break
    await new Promise((r) => setTimeout(r, 5000))
  }
  const out = await db.execute(`select body from public.outputs where job_id = ${lit(job)}::uuid order by created_at`)
  const tasks = await db.execute(`select title from public.tasks where job_id = ${lit(job)}::uuid`)
  const lessons = await db.execute(`select body from public.lessons where from_job = ${lit(job)}::uuid`)
  console.log('SAID:', text, '\nSTATE:', state, '\nOUT:', JSON.stringify(out.rows.map((r) => (r as { body: string }).body.slice(0, 400))), '\nTASKS:', JSON.stringify(tasks.rows), '\nLESSONS:', JSON.stringify(lessons.rows), '\n---')
}
await origins.release()
