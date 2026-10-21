import { describe, expect, it } from 'vitest'
// @ts-expect-error - a browser module with no type declarations
import {
  compareFiles,
  exactFolders,
  folderAddress,
  localSummary,
} from '../../web/studio/bc/drivepick.js'

// A fake folder handle: async-iterable entries, as the browser's directory handle is.
const handle = (name: string, entries: Array<[string, 'file' | 'directory']>) => ({
  name,
  async *values() {
    for (const [n, kind] of entries) yield { name: n, kind }
  },
})

describe('a folder chosen on this PC is matched with Google Drive', () => {
  it('reads the names of the top-level files and folders', async () => {
    const s = await localSummary(
      handle('Course material', [
        ['Week 1.pdf', 'file'],
        ['Old', 'directory'],
      ]),
    )
    expect(s).toEqual({ name: 'Course material', files: ['Week 1.pdf'], folders: ['Old'] })
  })

  it('caps how many entries are read', async () => {
    const many: Array<[string, 'file']> = Array.from({ length: 100 }, (_, i) => [
      `f${i}.pdf`,
      'file',
    ])
    const s = await localSummary(handle('Big', many), 10)
    expect(s.files).toHaveLength(10)
  })

  it('only an exact name is a candidate', () => {
    const found = [
      { id: '1', name: 'Course material', isFolder: true },
      { id: '2', name: 'Course', isFolder: true },
      { id: '3', name: 'Course material', isFolder: false },
    ]
    expect(exactFolders(found, 'Course material').map((f) => f.id)).toEqual(['1'])
  })

  it('a folder is verified when every local file is in the Drive folder', () => {
    const drive = [
      { name: 'Week 1.pdf', isFolder: false },
      { name: 'Week 2.pdf', isFolder: false },
      { name: 'Old', isFolder: true },
    ]
    expect(compareFiles(['Week 1.pdf', 'Week 2.pdf'], drive)).toEqual({
      checked: 2,
      found: 2,
      missing: [],
    })
  })

  it('names the local files Drive does not hold', () => {
    const drive = [{ name: 'Week 1.pdf', isFolder: false }]
    const r = compareFiles(['Week 1.pdf', 'Week 2.pdf'], drive)
    expect(r.found).toBe(1)
    expect(r.missing).toEqual(['Week 2.pdf'])
  })

  it('a folder with no files checks nothing, which is not a pass', () => {
    expect(compareFiles([], [{ name: 'x', isFolder: false }])).toEqual({
      checked: 0,
      found: 0,
      missing: [],
    })
  })

  it('builds the address the office attaches', () => {
    expect(folderAddress('1AbC-_x')).toBe('https://drive.google.com/drive/folders/1AbC-_x')
  })
})
