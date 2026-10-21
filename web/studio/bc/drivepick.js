/*
  CHOOSING A GOOGLE DRIVE FOLDER FROM THIS PC (21 October 2026).

  A browser cannot hand over the path of a folder it picks, only its name and its contents. So the folder is CHECKED against
  Google Drive before anything is saved:

    1. the folder's name is searched in Drive, and only an exact match is a candidate;
    2. each candidate's contents are read from Drive, and the names of this folder's files are compared with them;
    3. the person confirms the one whose files all appear in Drive.

  Nothing here saves. It reads the folder you picked and asks Drive what it holds. The save is the office's `attach`, which
  the page makes only after the confirmation.

  Chrome and Edge can pick a folder. Other browsers say so, rather than offering a picker that is not there.
*/

/** Whether this browser can pick a folder at all. */
export const canPickFolder = () => typeof globalThis.showDirectoryPicker === 'function'

/**
 * Ask the person for a folder on this PC. Null when they cancel, which is not an error.
 * Read-only: the handle lets the page read the folder's names, nothing is written.
 */
export async function pickLocalFolder() {
  if (!canPickFolder()) throw new Error('This browser cannot choose a folder. Use Chrome or Edge.')
  try {
    return await globalThis.showDirectoryPicker({ mode: 'read' })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') return null
    throw e
  }
}

/**
 * What the folder holds at its top level: its name, and the names of its files and folders. Capped, because a folder
 * of two thousand files need not be read in full to be recognised.
 */
export async function localSummary(handle, limit = 60) {
  const files = []
  const folders = []
  for await (const entry of handle.values()) {
    if (files.length + folders.length >= limit) break
    if (entry.kind === 'file') files.push(entry.name)
    else folders.push(entry.name)
  }
  return { name: handle.name, files, folders }
}

/** The Drive folders whose name is exactly this one. Exact, because "Course" is not "Course material". */
export function exactFolders(found, name) {
  return (Array.isArray(found) ? found : []).filter((f) => f?.isFolder === true && f?.name === name)
}

/**
 * Compare this folder's files with a Drive folder's children. Folders are not compared, because Drive keeps a folder of the
 * same name in several places. `checked` is 0 for a folder with no files, which is not a failure, only not verifiable.
 */
export function compareFiles(localFiles, driveChildren) {
  const driveNames = new Set((Array.isArray(driveChildren) ? driveChildren : []).filter((c) => c?.isFolder !== true).map((c) => c.name))
  const missing = localFiles.filter((n) => !driveNames.has(n))
  return { checked: localFiles.length, found: localFiles.length - missing.length, missing }
}

/** The Drive folder's address, in the form the office's attach reads. */
export const folderAddress = (id) => `https://drive.google.com/drive/folders/${encodeURIComponent(id)}`
