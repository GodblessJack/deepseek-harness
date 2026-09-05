// @vitest-environment jsdom
// PDF draft-file flow: createDraftFiles admission, the verbatim upload
// reference line, sendSession's upload-then-prompt composition over the
// workspace-upload endpoint, and the input-state file id channel (addFiles /
// removeFile / submit / restore), following the service spec bench pattern.
import { describe, expect, it, vi } from 'vitest'
import { makeTranslate, SlotTestRuntime } from '@deepseek-ai/dsh-client-test-runtime'
import { ComposerBlockRegistry } from '../src/client/input/blocks.ts'
import { InputHub } from '../src/client/input/hub.ts'
import { SessionInputShell } from '../src/client/input/facade.ts'
import {
  ConversationController, formatUploadReference, UnsupportedFileMediaTypeError, WorkspaceUploadError,
} from '../src/client/service.ts'
import { zh } from '../src/client/locales.ts'
import type { DraftAttachmentId } from '../src/client/contract/input.ts'

const PDF = (name = 'a.pdf'): File => new File([Uint8Array.of(1)], name, { type: 'application/pdf' })

async function bench() {
  const runtime = await SlotTestRuntime.create()
  const prompt = vi.fn(() => Promise.resolve({ ok: true as const, value: { accepted: true as const } }))
  await runtime.sessions.add({ id: 's1', session: { prompt } })
  const hub = new InputHub(runtime.ctx, makeTranslate(zh, {}))
  await runtime.ctx.plugin(ConversationController, {
    input: hub,
    blocks: new ComposerBlockRegistry(),
  }).await()
  const root = runtime.ctx.get('conversation') as ConversationController
  const shell = hub.shellFor(runtime.sessions.binding('s1')!)
  const abandon = vi.fn()
  const retire: { onRetire?: ((retirement: unknown) => void) | undefined } = {}
  await runtime.sessions.updateSessionSnapshot('s1', () => {})
  const face = runtime.sessions.binding('s1')!.session as unknown as Record<string, unknown>
  face['beginSubmission'] = vi.fn((input: { onRetire?: (retirement: unknown) => void }) => {
    retire.onRetire = input.onRetire
    return { requestId: 'req-echo' as never, abandon }
  })
  return { runtime, root, shell, hub, prompt, abandon, retire, session: runtime.sessions.binding('s1')!.session }
}

interface FetchAnswer {
  readonly ok: boolean
  readonly status: number
  readonly statusText: string
  readonly body?: unknown
}

function stubFetch(responses: readonly FetchAnswer[]): ReturnType<typeof vi.fn> {
  let index = 0
  return vi.fn(() => {
    const answer = responses[Math.min(index, responses.length - 1)]
    index += 1
    if (answer === undefined) throw new Error('unexpected extra upload call')
    return Promise.resolve(
      answer.ok
        ? { ok: true, status: answer.status, statusText: answer.statusText, json: () => Promise.resolve(answer.body) }
        : { ok: false, status: answer.status, statusText: answer.statusText, json: () => Promise.reject(new Error('unused')) },
    )
  })
}

describe('draft file admission', () => {
  it('createDraftFiles accepts only application/pdf and allocates no preview', async () => {
    const b = await bench()
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unused')
    try {
      const [file] = b.root.createDraftFiles([PDF()])
      expect(file).toMatchObject({ kind: 'file' })
      expect(file?.file.name).toBe('a.pdf')
      expect('previewUrl' in (file ?? {})).toBe(false)
      expect(b.root.draftFiles([file!.id])).toHaveLength(1)
      expect(() => b.root.createDraftFiles([PDF('vector.svg')])).not.toThrow()
      expect(() => b.root.createDraftFiles([
        new File([Uint8Array.of(2)], 'pixel.png', { type: 'image/png' }),
      ])).toThrow(UnsupportedFileMediaTypeError)
      expect(created).not.toHaveBeenCalled()
    } finally {
      created.mockRestore()
      await b.runtime.dispose()
    }
  })

  it('formatUploadReference is verbatim', () => {
    expect(formatUploadReference('a.pdf', 'uploads/a.pdf', 1_048_576)).toBe('[attached file] uploads/a.pdf (1 MB)')
  })

  it('formats binary sizes with one space and adaptive units', () => {
    expect(formatUploadReference('b.pdf', 'uploads/b.pdf', 12_288)).toBe('[attached file] uploads/b.pdf (12 KB)')
    expect(formatUploadReference('c.pdf', 'uploads/c.pdf', 1_572_864)).toBe('[attached file] uploads/c.pdf (1.5 MB)')
    expect(formatUploadReference('d.pdf', 'uploads/d.pdf', 512)).toBe('[attached file] uploads/d.pdf (512 B)')
  })
})

describe('sendSession PDF upload flow', () => {
  it('uploads PDFs then prompts with reference lines ahead of the text', async () => {
    const b = await bench()
    const fetchMock = stubFetch([{ ok: true, status: 200, statusText: 'OK', body: { path: 'uploads/a.pdf', bytes: 1_048_576 } }])
    vi.stubGlobal('fetch', fetchMock)
    try {
      const [file] = b.root.createDraftFiles([PDF()])
      await expect(b.root.sendSession(b.session, '请分析', [], [file!.id], 'queue'))
        .resolves.toEqual({ kind: 'success' })
      expect(fetchMock).toHaveBeenCalledWith('/api/workspace.upload?sessionId=s1', {
        method: 'POST',
        body: expect.any(FormData) as FormData,
      })
      expect(b.prompt).toHaveBeenCalledTimes(1)
      expect(b.prompt).toHaveBeenCalledWith(
        [{ type: 'text', text: '[attached file] uploads/a.pdf (1 MB)\n\n请分析' }],
        'queue',
        undefined,
        'req-echo',
      )
    } finally {
      vi.unstubAllGlobals()
      await b.runtime.dispose()
    }
  })

  it('joins multiple reference lines in draft order and omits the separator for a file-only message', async () => {
    const b = await bench()
    const fetchMock = stubFetch([
      { ok: true, status: 200, statusText: 'OK', body: { path: 'uploads/a.pdf', bytes: 1_048_576 } },
      { ok: true, status: 200, statusText: 'OK', body: { path: 'uploads/a-1.pdf', bytes: 12_288 } },
    ])
    vi.stubGlobal('fetch', fetchMock)
    try {
      const files = b.root.createDraftFiles([PDF(), PDF('b.pdf')])
      await expect(b.root.sendSession(b.session, '', [], files.map(file => file.id), 'queue'))
        .resolves.toEqual({ kind: 'success' })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(b.prompt).toHaveBeenCalledWith(
        [{
          type: 'text',
          text: '[attached file] uploads/a.pdf (1 MB)\n[attached file] uploads/a-1.pdf (12 KB)',
        }],
        'queue',
        undefined,
        'req-echo',
      )
    } finally {
      vi.unstubAllGlobals()
      await b.runtime.dispose()
    }
  })

  it('abandons the echo and throws when an upload fails, keeping the draft registered', async () => {
    const b = await bench()
    vi.stubGlobal('fetch', stubFetch([{ ok: false, status: 413, statusText: 'Payload Too Large' }]))
    try {
      const [file] = b.root.createDraftFiles([PDF()])
      await expect(b.root.sendSession(b.session, '请分析', [], [file!.id], 'queue'))
        .rejects.toThrow(WorkspaceUploadError)
      await expect(b.root.sendSession(b.session, '请分析', [], [file!.id], 'queue'))
        .rejects.toThrow('workspace upload failed (413 Payload Too Large)')
      expect(b.prompt).not.toHaveBeenCalled()
      expect(b.abandon).toHaveBeenCalledTimes(2)
      expect(b.root.draftFiles([file!.id])).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
      await b.runtime.dispose()
    }
  })

  it('rejects a malformed success body instead of forging a reference line', async () => {
    const b = await bench()
    vi.stubGlobal('fetch', stubFetch([{ ok: true, status: 200, statusText: 'OK', body: { path: 'uploads/a.pdf' } }]))
    try {
      const [file] = b.root.createDraftFiles([PDF()])
      await expect(b.root.sendSession(b.session, 'x', [], [file!.id], 'queue'))
        .rejects.toThrow(WorkspaceUploadError)
      expect(b.prompt).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      await b.runtime.dispose()
    }
  })

  it('is byte-identical to the image-and-text path without PDFs and never uploads', async () => {
    const b = await bench()
    const fetchMock = stubFetch([])
    vi.stubGlobal('fetch', fetchMock)
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:plain')
    try {
      const [image] = b.root.createDraftImages([
        new File([Uint8Array.of(1, 2, 3)], 'a.png', { type: 'image/png' }),
      ])
      const sending = b.root.sendSession(b.session, '带图', [image!.id], [], 'queue')
      await vi.waitFor(() => { expect(b.prompt).toHaveBeenCalledOnce() })
      b.retire.onRetire?.({ reason: 'observed', attachments: [] })
      await expect(sending).resolves.toEqual({ kind: 'success' })
      expect(b.prompt).toHaveBeenCalledWith(
        [
          { type: 'image', mediaType: 'image/png', data: expect.any(String) as string, name: 'a.png' },
          { type: 'text', text: '带图' },
        ],
        'queue',
        undefined,
        'req-echo',
      )
      await expect(b.root.sendSession(b.session, '纯文本', [], [], 'queue')).resolves.toEqual({ kind: 'success' })
      expect(b.prompt).toHaveBeenLastCalledWith([{ type: 'text', text: '纯文本' }], 'queue', undefined, 'req-echo')
      expect(fetchMock).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
      created.mockRestore()
      await b.runtime.dispose()
    }
  })
})

describe('input file draft channel', () => {
  const commandImages = {
    serialize: () => Promise.resolve([]),
    release: () => {},
    unsupportedNotice: (token: string) => `${token.trim()} images-unsupported`,
  }

  it('addFiles/removeFile publish ordered fileIds and submit carries them to the default sink', async () => {
    const sink = vi.fn(() => Promise.resolve({ kind: 'success' as const }))
    const shell = new SessionInputShell({ actx: {} as never, defaultSink: sink, commandImages })
    const first = 'file-1' as DraftAttachmentId
    const second = 'file-2' as DraftAttachmentId
    expect(shell.addFiles([first])).toBe(true)
    expect(shell.addFiles([second])).toBe(true)
    expect(shell.snapshot.fileIds).toEqual([first, second])
    shell.setDraft('结合文档分析')
    shell.submit('queue')
    await vi.waitFor(() => {
      expect(sink).toHaveBeenCalledWith('结合文档分析', [], [first, second], 'queue', expect.any(AbortSignal))
    })
    expect(shell.snapshot.fileIds).toEqual([])
    shell.addFiles([first])
    shell.removeFile(first)
    expect(shell.snapshot.fileIds).toEqual([])
  })

  it('restores file ids after a failed file-only send and returns them at disposal', async () => {
    let settle!: (outcome: { kind: 'success' } | { kind: 'error' }) => void
    const shell = new SessionInputShell({
      actx: {} as never,
      defaultSink: () => new Promise<{ kind: 'success' } | { kind: 'error' }>((resolve) => { settle = resolve }),
      commandImages,
    })
    const file = 'file-1' as DraftAttachmentId
    shell.addFiles([file])
    shell.submit('queue')
    expect(shell.snapshot.fileIds).toEqual([])
    settle({ kind: 'error' })
    await vi.waitFor(() => { expect(shell.snapshot.fileIds).toEqual([file]) })
    shell.submit('queue')
    expect(shell.dispose()).toEqual({ imageIds: [], fileIds: [file] })
  })

  it('maps an upload failure to the file.uploadFailed notice copy end to end', async () => {
    const b = await bench()
    vi.stubGlobal('fetch', stubFetch([{ ok: false, status: 413, statusText: 'Payload Too Large' }]))
    try {
      const [file] = b.root.createDraftFiles([PDF('big.pdf')])
      b.shell.addFiles([file!.id])
      b.shell.submit()
      await vi.waitFor(() => {
        expect(b.shell.notices.getSnapshot()).toMatchObject({
          level: 'error',
          text: 'PDF 上传失败：workspace upload failed (413 Payload Too Large)',
        })
      })
      expect(b.shell.snapshot.fileIds).toEqual([file!.id])
      expect(b.root.draftFiles([file!.id])).toHaveLength(1)
    } finally {
      vi.unstubAllGlobals()
      await b.runtime.dispose()
    }
  })
})
