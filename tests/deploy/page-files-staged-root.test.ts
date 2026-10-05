import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { collectPageFiles } from '../../scripts/deploy/lib/page-files.ts'

/**
 * `deploy:hq-page --root=<dir>` (the public Sample's staged deploys) sends a STAGED studio folder: the live bytes plus one change.
 * When the shared upload-set library replaced that script's private walk, this option had to survive. It replaces the studio folder
 * (including its `index.html`) and nothing else, and the default is unchanged.
 */
describe('a staged studio folder replaces the studio folder and only that', () => {
  const staged = join(tmpdir(), `staged-studio-${String(process.pid)}`)
  mkdirSync(join(staged, 'bc'), { recursive: true })
  writeFileSync(join(staged, 'index.html'), 'STAGED-INDEX')
  writeFileSync(join(staged, 'app.js'), 'STAGED-APP')
  writeFileSync(join(staged, 'bc', 'x.js'), 'STAGED-BC')

  it('takes index.html and every studio file from the staged folder, under both paths', async () => {
    const files = await collectPageFiles('.', staged)
    expect(files.get('index.html')?.toString()).toBe('STAGED-INDEX')
    expect(files.get('studio/app.js')?.toString()).toBe('STAGED-APP')
    expect(files.get('app.js')?.toString()).toBe('STAGED-APP')
    expect(files.get('studio/bc/x.js')?.toString()).toBe('STAGED-BC')
    // And nothing from the working tree's studio folder leaks in.
    expect([...files.keys()].some((k) => k === 'studio/session.js')).toBe(false)
  })

  it('still takes the non-studio files from the working tree', async () => {
    const files = await collectPageFiles('.', staged)
    for (const f of [
      'api/notebook.py',
      'api/notebook-act.py',
      'scripts/notebook/act.py',
      'requirements.txt',
      'vercel.json',
    ]) {
      expect(files.has(f), f).toBe(true)
    }
  })

  it('control: without a staged folder the working tree studio is used', async () => {
    const files = await collectPageFiles('.')
    expect(files.get('index.html')?.toString()).not.toBe('STAGED-INDEX')
    expect(files.has('studio/session.js')).toBe(true)
  })
})
