/**
 * The office a script or a suite works in when it holds no claimed job (multi-user P3).
 *
 * The retrieval, memory and capability readers (`src/knowledge/office.ts`) are asked of one office and never default to
 * one. A worker handler names the office of its claimed job; a script that has no job names an office, and unless it is
 * about a real person's data that office is the TEST office, which is where harness traffic belongs. A suite that
 * asserts on a real office's data passes that office's id explicitly instead.
 */
import type { SqlExecutor } from '../src/db/executor.ts'

export const testOffice = async (db: SqlExecutor): Promise<{ readonly officeId: string }> => {
  const { rows } = await db.execute('select app.test_office()::text as id')
  return { officeId: String((rows[0] as { id: string }).id) }
}

/**
 * The sole person's office (Grant's, while there is one person). For a suite whose raw writes carry no project, job or
 * harness-shaped actor: the compatibility bridge files those under this office, so that is where the suite must read.
 */
export const personOffice = async (db: SqlExecutor): Promise<{ readonly officeId: string }> => {
  const { rows } = await db.execute('select app.sole_person_office()::text as id')
  return { officeId: String((rows[0] as { id: string }).id) }
}

/** The office a project belongs to, for a suite that creates its own project and asserts about it. */
export const officeOfProject = async (
  db: SqlExecutor,
  projectId: string,
): Promise<{ readonly officeId: string }> => {
  const { rows } = await db.execute(
    `select office_id::text as id from public.projects where project_id = '${projectId.replace(/'/g, "''")}'::uuid`,
  )
  const id = (rows[0] as { id?: string } | undefined)?.id
  if (id === undefined) throw new Error(`no such project: ${projectId}`)
  return { officeId: id }
}
