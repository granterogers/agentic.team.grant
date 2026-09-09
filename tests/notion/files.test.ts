/**
 * Uploads, without the network.
 *
 * The live round trip is `verify:notion-write`. These are the branches a live
 * test cannot reach cheaply: a file Notion will not take, a name it will not
 * take, a size that needs splitting, and a workspace limit that can only be
 * discovered by being refused.
 */
import { describe, expect, it } from 'vitest'
import { NotionClient } from '../../src/notion/api.ts'
import {
  contentTypeFor,
  fileBlock,
  fileProperty,
  MAX_FILENAME_BYTES,
  NotionFileError,
  PART_SIZE,
  SINGLE_PART_LIMIT,
  uploadFile,
} from '../../src/notion/files.ts'

/** A client whose JSON calls are recorded, and a stubbed global fetch for bytes. */
const harness = (sendStatus = 200, sendBody = '{"status":"uploaded"}') => {
  const calls: { endpoint: string; body: unknown }[] = []
  const client = new NotionClient('ntn_test', {
    fetchImpl: (async (url: string | URL, init?: { body?: string }) => {
      const endpoint = String(url).replace('https://api.notion.com/v1', '')
      calls.push({ endpoint, body: init?.body === undefined ? undefined : JSON.parse(init.body) })
      return new Response(
        JSON.stringify({
          id: 'upload-1',
          status: 'pending',
          upload_url: 'https://api.notion.com/v1/file_uploads/upload-1/send',
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }) as unknown as typeof fetch,
  })
  const sends: number[] = []
  const original = globalThis.fetch
  globalThis.fetch = (async (_url: string | URL, init?: { body?: FormData }) => {
    // Only the multipart send goes through the global; JSON goes to fetchImpl.
    const form = init?.body as FormData | undefined
    const file = form?.get('file') as Blob | null
    sends.push(file?.size ?? 0)
    return new Response(sendBody, { status: sendStatus })
  }) as unknown as typeof fetch
  return {
    client,
    calls,
    sends,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

describe('what Notion will and will not take', () => {
  it('maps the formats a notebook actually produces', () => {
    // Grant asked for "audio snippets, etc" by name, so these are the ones
    // that must not be refused.
    expect(contentTypeFor('overview.mp3')).toBe('audio/mpeg')
    expect(contentTypeFor('walkthrough.mp4')).toBe('video/mp4')
    expect(contentTypeFor('Legacy Questionnaire.pdf')).toBe('application/pdf')
    expect(contentTypeFor('Avatar Document.docx')).toContain('wordprocessingml')
  })

  it('is case-insensitive about the extension', () => {
    expect(contentTypeFor('OVERVIEW.MP3')).toBe('audio/mpeg')
  })

  it('refuses what it cannot name, rather than guessing', () => {
    expect(contentTypeFor('thing.exe')).toBeNull()
    expect(contentTypeFor('no-extension')).toBeNull()
  })

  it('refuses an unsupported file before making any request', async () => {
    const h = harness()
    try {
      await expect(uploadFile(h.client, 'x.exe', new Uint8Array([1]))).rejects.toThrow(
        NotionFileError,
      )
      // The point: nothing was sent. A failure on the third call has already
      // spent two round trips.
      expect(h.calls).toHaveLength(0)
      expect(h.sends).toHaveLength(0)
    } finally {
      h.restore()
    }
  })

  it('refuses a filename over Notion’s byte limit', async () => {
    const h = harness()
    try {
      const long = `${'a'.repeat(MAX_FILENAME_BYTES)}.txt`
      await expect(uploadFile(h.client, long, new Uint8Array([1]))).rejects.toThrow(/shorten/i)
    } finally {
      h.restore()
    }
  })
})

describe('single and multi-part', () => {
  it('sends a small file in one request', async () => {
    const h = harness()
    try {
      const out = await uploadFile(h.client, 'small.txt', new Uint8Array(1_000))
      expect(out.parts).toBe(1)
      expect(h.sends).toHaveLength(1)
      expect(h.calls[0]?.endpoint).toBe('/file_uploads')
      expect((h.calls[0]?.body as { mode: string } | undefined)?.mode).toBe('single_part')
      // No completion call for a single part.
      expect(h.calls.some((c) => c.endpoint.includes('/complete'))).toBe(false)
    } finally {
      h.restore()
    }
  })

  it('splits a file over 20MB and completes it', async () => {
    const h = harness()
    try {
      const big = new Uint8Array(SINGLE_PART_LIMIT + PART_SIZE)
      const out = await uploadFile(h.client, 'big.mp4', big)
      expect(out.parts).toBe(Math.ceil(big.length / PART_SIZE))
      expect(h.sends).toHaveLength(out.parts)
      expect((h.calls[0]?.body as { mode: string } | undefined)?.mode).toBe('multi_part')
      // Multi-part is not finished until it is completed.
      expect(h.calls.some((c) => c.endpoint.includes('/complete'))).toBe(true)
    } finally {
      h.restore()
    }
  })

  it('translates a workspace size refusal into something actionable', async () => {
    // The one limit that cannot be checked locally: free workspaces cap a file
    // at 5 MiB and the API does not say which kind this is.
    const h = harness(400, 'File size exceeds the limit for this workspace')
    try {
      await expect(uploadFile(h.client, 'big.mp3', new Uint8Array(100))).rejects.toThrow(/5 MiB/)
    } finally {
      h.restore()
    }
  })
})

describe('attaching', () => {
  const up = (filename: string) => ({ id: 'u1', filename, bytes: 1, parts: 1 })

  it('gives each kind of file the block that renders it', () => {
    // An audio overview delivered as a download link is attached and useless.
    expect(fileBlock(up('a.mp3')).type).toBe('audio')
    expect(fileBlock(up('a.mp4')).type).toBe('video')
    expect(fileBlock(up('a.png')).type).toBe('image')
    expect(fileBlock(up('a.pdf')).type).toBe('pdf')
    expect(fileBlock(up('a.docx')).type).toBe('file')
  })

  it('references the upload by id, which is how Notion attaches it', () => {
    const block = fileBlock(up('a.mp3'), 'the overview')
    const body = block.audio as { file_upload: { id: string }; caption: unknown[] }
    expect(body.file_upload.id).toBe('u1')
    expect(body.caption).toHaveLength(1)
  })

  it('builds a database file property from several uploads', () => {
    const prop = fileProperty([up('a.mp3'), up('b.pdf')])
    expect(prop.files).toHaveLength(2)
  })
})
