/** The upload target (migration 0688): judged inside the office; a foreign target and a missing one are one refusal. */
import { type Ctx, callerRoles, lit } from '../p3-app-lib.ts'

export async function cases(c: Ctx): Promise<void> {
  const { A, B } = c
  const run = Math.random().toString(36).slice(2, 8)
  const q = async (sql: string) => (await c.db.execute(sql)).rows as Record<string, unknown>[]
  const proj = async (office: string, slug: string): Promise<string> => {
    await c.db.execute(
      `insert into public.projects (slug, name, status, office_id) values (${lit(slug)}, ${lit(slug)}, 'paused', '${office}') on conflict do nothing`,
    )
    return String(
      (
        await q(
          `select project_id from public.projects where office_id = '${office}' and slug = ${lit(slug)}`,
        )
      )[0]?.project_id,
    )
  }
  const pa = await proj(A, `up-${run}`)
  const pb = await proj(B, `up-${run}`)
  const S = 'service_role'
  const target = async (
    office: string,
    kind: string,
    project: string,
    contact: string | null = null,
  ) =>
    c.json(
      await c.exec(
        S,
        `select public.hq_upload_target('${office}', ${lit(kind)}, '${project}', ${contact === null ? 'null' : `'${contact}'`})`,
      ),
    )
  c.check((await target(A, 'document_upload', pa)).includes(pa), "A may upload to A's project", '')
  const foreign = await target(A, 'document_upload', pb)
  const missing = await target(A, 'document_upload', c.nobody())
  c.check(
    foreign === missing && foreign.includes('no such dashboard project'),
    "B's project and a missing project are one refusal to A",
    foreign,
  )
  const contact = String(
    (
      await q(
        `insert into public.contacts (project_id, name) values ('${pb}', ${lit(`Contact ${run}`)}) returning contact_id`,
      )
    )[0]?.contact_id,
  )
  const fc = await target(A, 'contact_photo', pb, contact)
  const mc = await target(A, 'contact_photo', pa, c.nobody())
  c.check(
    fc === mc && fc.includes('no such contact'),
    "B's contact and a missing contact are one refusal to A",
    fc,
  )
  c.check(
    (
      await c.refusal(S, `select public.hq_upload_target(null::uuid, 'document_upload', '${pa}')`)
    ).includes('no_office'),
    'no office, no target',
    '',
  )
  for (const role of callerRoles) {
    c.check(
      (
        await c.refusal(role, `select public.hq_upload_target('${A}', 'document_upload', '${pa}')`)
      ).includes('permission denied'),
      `${role} cannot call it`,
      '',
    )
  }
}
