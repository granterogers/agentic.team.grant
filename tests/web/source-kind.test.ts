import { describe, expect, it } from 'vitest'
// @ts-expect-error - a browser module with no type declarations
import { connectorFor } from '../../web/studio/source-kind.js'

describe('a pasted link is named for the connector that claims it', () => {
  it('a Drive folder link is the drive connector', () => {
    expect(connectorFor('https://drive.google.com/drive/folders/1AbC_dEf-123?usp=sharing')).toBe(
      'drive',
    )
    expect(connectorFor('https://drive.google.com/drive/u/0/folders/1AbC')).toBe('drive')
  })

  it('a Drive file is not a folder, so it is not a connector', () => {
    expect(connectorFor('https://docs.google.com/document/d/1AbC/edit')).toBeNull()
    expect(connectorFor('https://drive.google.com/file/d/1AbC/view')).toBeNull()
  })

  it('a Notion page or site is the notion connector', () => {
    expect(connectorFor('https://www.notion.so/Team-Plan-0123456789abcdef')).toBe('notion')
    expect(connectorFor('https://team.notion.site/Handbook-0123')).toBe('notion')
  })

  it('a NotebookLM notebook is the notebooklm connector', () => {
    expect(connectorFor('https://notebooklm.google.com/notebook/abc-123')).toBe('notebooklm')
  })

  it('a look-alike host is not claimed', () => {
    expect(connectorFor('https://drive.google.com.evil.example/drive/folders/1')).toBeNull()
    expect(connectorFor('https://notion.so.evil.example/page')).toBeNull()
    expect(connectorFor('https://evil.example/?u=https://notion.so/x')).toBeNull()
  })

  it('a website, an API or text that is not a link is a reference, not a connector', () => {
    expect(connectorFor('https://competitor.example/pricing')).toBeNull()
    expect(connectorFor('not a link at all')).toBeNull()
    expect(connectorFor('')).toBeNull()
    expect(connectorFor(undefined)).toBeNull()
  })
})
