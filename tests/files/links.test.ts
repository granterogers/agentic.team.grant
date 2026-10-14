/**
 * Signed-link authorisation (issue #468): a link is given only to a person whose office and project membership cover the
 * object's owner. Fixtures only, no database.
 */
import { describe, expect, it } from 'vitest'
import {
  type LinkLookup,
  mayLinkDocument,
  mayLinkPhoto,
  mayLinkProjectFile,
} from '../../src/files/links.ts'

const OFFICE_A = '2a2cd4d4-48c9-41ba-8271-a798631997da'
const OFFICE_B = 'e13ce7a9-831b-49d7-83a5-2ede9c1a97d0'
const PROJECT_A1 = 'a0000000-0000-4000-8000-000000000001'
const PROJECT_A2 = 'a0000000-0000-4000-8000-000000000002'
const PROJECT_B1 = 'b0000000-0000-4000-8000-000000000001'
const DOC_A = `${PROJECT_A1}/upload/plan.png`
const DOC_B = `${PROJECT_B1}/upload/secret.pdf`
const PHOTO_A = 'contacts/a/kevin.jpg'
const PHOTO_B = 'contacts/b/priya.jpg'

/** A database of rows: documents by path, photos by path, and each project's office. */
function lookupFor(
  documents: Record<string, { office: string; project: string }>,
  photos: Record<string, string>,
  projectOffices: Record<string, string>,
): LinkLookup {
  return {
    documentOwner: async (path, office) => {
      const row = documents[path]
      // The gateway filters by office in the query; this fixture does the same.
      return row !== undefined && row.office === office ? row : null
    },
    photoProject: async (path) => photos[path] ?? null,
    projectOffice: async (project) => projectOffices[project] ?? null,
    officeProjects: async (office) =>
      Object.entries(projectOffices)
        .filter(([, o]) => o === office)
        .map(([p]) => p),
  }
}

const database = lookupFor(
  {
    [DOC_A]: { office: OFFICE_A, project: PROJECT_A1 },
    [DOC_B]: { office: OFFICE_B, project: PROJECT_B1 },
  },
  { [PHOTO_A]: PROJECT_A2, [PHOTO_B]: PROJECT_B1 },
  { [PROJECT_A1]: OFFICE_A, [PROJECT_A2]: OFFICE_A, [PROJECT_B1]: OFFICE_B },
)

describe('a signed link to a document', () => {
  it('is given to a person in the office that owns the document, for a project of theirs', async () => {
    expect(await mayLinkDocument(database, OFFICE_A, DOC_A)).toBe(true)
  })

  it('is refused across offices: another office document is not found under this office', async () => {
    expect(await mayLinkDocument(database, OFFICE_A, DOC_B)).toBe(false)
  })

  it('is refused even if the lookup returned a row owned by another office (defence in depth)', async () => {
    const leaky = lookupFor(
      { [DOC_B]: { office: OFFICE_B, project: PROJECT_B1 } },
      {},
      { [PROJECT_B1]: OFFICE_B },
    )
    const forgedLookup: LinkLookup = {
      ...leaky,
      documentOwner: async () => ({ office: OFFICE_B, project: PROJECT_B1 }),
    }
    expect(await mayLinkDocument(forgedLookup, OFFICE_A, DOC_B)).toBe(false)
  })

  it('is refused across projects: a project outside this office membership', async () => {
    const outside = lookupFor(
      { [DOC_A]: { office: OFFICE_A, project: PROJECT_A1 } },
      {},
      { [PROJECT_A1]: OFFICE_A },
    )
    const membershipWithout: LinkLookup = { ...outside, officeProjects: async () => [PROJECT_A2] }
    expect(await mayLinkDocument(membershipWithout, OFFICE_A, DOC_A)).toBe(false)
  })

  it('is refused for a path no document row names, and for an empty path', async () => {
    expect(await mayLinkDocument(database, OFFICE_A, `${PROJECT_A1}/upload/missing.png`)).toBe(
      false,
    )
    expect(await mayLinkDocument(database, OFFICE_A, '')).toBe(false)
  })
})

describe('a signed link to a file under a project prefix (uploads, screenshots)', () => {
  it('is given for a file under a project of this office', async () => {
    expect(await mayLinkProjectFile(database, OFFICE_A, `${PROJECT_A1}/browser/shot.png`)).toBe(
      true,
    )
  })

  it('is refused for a file under another office project', async () => {
    expect(await mayLinkProjectFile(database, OFFICE_A, `${PROJECT_B1}/browser/shot.png`)).toBe(
      false,
    )
  })

  it('is refused when the first segment is not a project id', async () => {
    expect(await mayLinkProjectFile(database, OFFICE_A, 'files/../../shot.png')).toBe(false)
    expect(await mayLinkProjectFile(database, OFFICE_A, 'shot.png')).toBe(false)
  })
})

describe('a signed link to a contact photograph', () => {
  it('is given for a photo whose project is in this office', async () => {
    expect(await mayLinkPhoto(database, OFFICE_A, PHOTO_A)).toBe(true)
  })

  it('is refused for a photo whose project belongs to another office', async () => {
    expect(await mayLinkPhoto(database, OFFICE_A, PHOTO_B)).toBe(false)
  })

  it('is refused for a photo naming a project that does not exist', async () => {
    const orphan = lookupFor({}, { [PHOTO_A]: 'c0000000-0000-4000-8000-00000000000c' }, {})
    expect(await mayLinkPhoto(orphan, OFFICE_A, PHOTO_A)).toBe(false)
  })
})
