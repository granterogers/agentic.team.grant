/**
 * Who may be given a signed link to a stored file (issue #468, storage policy). Pure except for the lookups it is handed,
 * so the same decision is tested here and used by the gateway, which supplies the database lookups.
 *
 * A link is minted with the service key, which reads any object. So the decision is made here, from the OWNER of the
 * object as the database records it, and never from the path alone: a path is text the browser was sent, and a path
 * that names another office or project would otherwise be signed for whoever asked.
 *
 * Plain words in this file's comments; no backticks, because this file is read by the template check.
 */
import { canReadObject } from './policy.ts'

export interface Owner {
  readonly office: string
  readonly project: string
}

/** The database lookups the decision needs. The gateway supplies them; a test supplies fixtures. */
export interface LinkLookup {
  /** The document row that holds this storage path, scoped to the office asked, or null. */
  documentOwner(path: string, office: string): Promise<Owner | null>
  /** The project a contact photo belongs to, or null. */
  photoProject(path: string): Promise<string | null>
  /** The office a project belongs to, or null when there is no such project. */
  projectOffice(project: string): Promise<string | null>
  /** Every project in an office, for the office's membership. */
  officeProjects(office: string): Promise<string[]>
}

/**
 * May this office's person be given a link to a document's file? The owner must be this office, the project must be one
 * of this office's projects, and the policy's read rule must hold. A missing row, a mismatched owner or an unknown
 * project each refuse, and none of them says which: the caller learns only that no link was made.
 */
export async function mayLinkDocument(
  lookup: LinkLookup,
  office: string,
  path: string,
): Promise<boolean> {
  if (path === '') return false
  const owner = await lookup.documentOwner(path, office)
  if (owner === null) return false
  const projects = await lookup.officeProjects(office)
  return canReadObject({ office: owner.office, project: owner.project }, { office, projects })
}

/**
 * A file the office wrote under its project's prefix (uploads and browser screenshots start with the project id). The
 * project is read from the first path segment, which must be a project id, and then judged as the other rules are.
 */
export async function mayLinkProjectFile(
  lookup: LinkLookup,
  office: string,
  path: string,
): Promise<boolean> {
  const first = path.split('/')[0] ?? ''
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(first)) return false
  const owner = await lookup.projectOffice(first)
  if (owner === null) return false
  const projects = await lookup.officeProjects(office)
  return canReadObject({ office: owner, project: first }, { office, projects })
}

/** As mayLinkDocument, for a contact's photograph: the photo's project supplies the owner, and its office must be this one. */
export async function mayLinkPhoto(
  lookup: LinkLookup,
  office: string,
  path: string,
): Promise<boolean> {
  if (path === '') return false
  const project = await lookup.photoProject(path)
  if (project === null) return false
  const owner = await lookup.projectOffice(project)
  if (owner === null) return false
  const projects = await lookup.officeProjects(office)
  return canReadObject({ office: owner, project }, { office, projects })
}
