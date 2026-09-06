// @vitest-environment jsdom
/**
 * Panel action-bar spec: close, copy, and print are pure user intents over
 * the controller and the browser clipboard/window surfaces. The controller is
 * the real CanvasController over a recording fake Remote (the established
 * fakeRemote pattern); clipboard, blob URLs, and window.open are stubbed at
 * the browser boundary because jsdom provides none of them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render } from '@testing-library/react'
import { CanvasPanel } from '../src/client/CanvasPanel.tsx'
import { CanvasController } from '../src/client/controller.ts'
import type { CanvasRemote } from '../src/client/controller.ts'
import type { CanvasPanelProps } from '../src/client/slots.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const sessionId = 'sess-1' as SessionId

/**
 * Framework-injected props (session/global kits + conversation input owner
 * share) that CanvasPanel accepts but never reads; this spec exercises the
 * action bar only, so inert vi.fn() stubs satisfy the prop types.
 */
const injectedStubs = {
  useSession: vi.fn(),
  useProjection: vi.fn(),
  useSessions: vi.fn(),
  useWorkspaces: vi.fn(),
  useInput: vi.fn(),
  inputActions: {
    setDraft: vi.fn(), addImages: vi.fn(), removeImage: vi.fn(), pruneImages: vi.fn(), submit: vi.fn(),
  },
} as unknown as Pick<CanvasPanelProps, 'useSession' | 'useProjection' | 'useSessions' | 'useWorkspaces' | 'useInput' | 'inputActions'>

interface FakeView {
  artifacts?: { id: string; title: string; kind: 'html' | 'markdown' | 'text'; content: string }[]
  selected?: string | null
}

/** Minimal Remote answering state polls with summaries and get with full records. */
function fakeRemote(view: FakeView): CanvasRemote {
  const artifacts = (view.artifacts ?? []).map(artifact => ({ ...artifact, updatedAt: '2026-09-05T00:00:00Z' }))
  return {
    state: async () => ({
      ok: true as const,
      value: {
        artifacts: artifacts.map(({ content: _content, ...summary }) => summary),
        selected: view.selected ?? null,
        rev: 1,
      },
    }),
    get: async (request: { id: string }) => {
      const artifact = artifacts.find(entry => entry.id === request.id)
      return artifact === undefined
        ? { ok: true as const, value: { ok: false, artifact: null, message: '作品不存在' } }
        : { ok: true as const, value: { ok: true, artifact, message: '' } }
    },
    select: async () => ({ ok: true as const, value: { ok: true, selected: null, message: '已选中' } }),
    demo: async () => ({ ok: true as const, value: { ok: true, message: '已填入' } }),
  }
}

function renderPanel(view: FakeView): { close: ReturnType<typeof vi.fn> } {
  const close = vi.fn()
  const controller = new CanvasController(fakeRemote(view), sessionId, { open: () => {}, close })
  render(<CanvasPanel canvas={controller} sessionId={sessionId} {...injectedStubs} />)
  return { close }
}

const writeText = vi.fn(async () => undefined)
const createObjectURL = vi.fn((_blob: Blob) => 'blob:mock-url')
const openedWindow = { print: vi.fn() }
const windowOpen = vi.fn(() => openedWindow)

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, configurable: true })
  vi.stubGlobal('open', windowOpen)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

async function settle(): Promise<void> {
  await act(async () => {})
}

describe('CanvasPanel action bar', () => {
  it('fetches content once while the revision and selection hold', async () => {
    vi.useFakeTimers()
    try {
      const calls: string[] = []
      const artifacts = [{ id: 'a1', title: 't', kind: 'text' as const, content: 'x', updatedAt: '2026-09-05T00:00:00Z' }]
      const remote: CanvasRemote = {
        state: async () => ({
          ok: true as const,
          value: { artifacts: artifacts.map(({ content: _content, ...summary }) => summary), selected: 'a1', rev: 7 },
        }),
        get: async (request: { id: string }) => {
          calls.push(request.id)
          return { ok: true as const, value: { ok: true, artifact: artifacts[0]!, message: '' } }
        },
        select: async () => ({ ok: true as const, value: { ok: true, selected: null, message: '' } }),
        demo: async () => ({ ok: true as const, value: { ok: true, message: '' } }),
      }
      const controller = new CanvasController(remote, sessionId, { open: () => {}, close: () => {} })
      render(<CanvasPanel canvas={controller} sessionId={sessionId} {...injectedStubs} />)
      await act(async () => {})
      await act(async () => { vi.advanceTimersByTime(3000) })
      // three more polls at the same revision: content fetched exactly once
      expect(calls).toEqual(['a1'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('closes the details column from every panel state', async () => {
    const { close } = renderPanel({ artifacts: [{ id: 'a1', title: 't', kind: 'text', content: 'x' }], selected: 'a1' })
    await settle()
    const buttons = document.querySelectorAll('button[title="关闭画布"]')
    expect(buttons.length).toBe(1)
    await act(async () => { buttons[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('shows the close action on an empty canvas without copy or print', async () => {
    const { close } = renderPanel({})
    await settle()
    expect(document.querySelector('button[title="关闭画布"]')).not.toBeNull()
    expect(document.querySelector('button[title="复制全文"]')).toBeNull()
    expect(document.querySelector('button[title="在新标签打开并打印"]')).toBeNull()
    await act(async () => { document.querySelector('button[title="关闭画布"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('offers a download link targeting the artifact-body endpoint', async () => {
    renderPanel({ artifacts: [{ id: 'a1', title: '报告', kind: 'markdown', content: 'x' }], selected: 'a1' })
    await settle()
    const link = document.querySelector<HTMLAnchorElement>('a[title="下载作品本体"]')
    expect(link).not.toBeNull()
    expect(link!.getAttribute('href')).toBe('/api/canvas.artifact?sessionId=sess-1&artifactId=a1')
    expect(link!.getAttribute('download')).toBe('')  // filename comes from the server's content-disposition
  })

  it('copies the selected artifact content to the clipboard', async () => {
    renderPanel({ artifacts: [{ id: 'a1', title: 't', kind: 'markdown', content: '# hi' }], selected: 'a1' })
    await settle()
    await settle()
    await act(async () => { document.querySelector('button[title="复制全文"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(writeText).toHaveBeenCalledWith('# hi')
  })

  it('opens an html artifact verbatim in a print view and calls print', async () => {
    renderPanel({ artifacts: [{ id: 'a1', title: '页面', kind: 'html', content: '<!doctype html><p>raw</p>' }], selected: 'a1' })
    await settle()
    await settle()
    await act(async () => { document.querySelector('button[title="在新标签打开并打印"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(createObjectURL).toHaveBeenCalledTimes(1)
    const blob = createObjectURL.mock.calls[0]![0]
    expect(blob.type).toBe('text/html')
    expect(await blob.text()).toBe('<!doctype html><p>raw</p>')
    expect(windowOpen).toHaveBeenCalledWith('blob:mock-url', '_blank')
    expect(openedWindow.print).toHaveBeenCalledTimes(1)
  })

  it('renders a markdown artifact through the panel renderer for printing', async () => {
    renderPanel({
      artifacts: [{ id: 'a1', title: '报告', kind: 'markdown', content: '| a | b |\n| --- | --- |\n| 1 | 2 |' }],
      selected: 'a1',
    })
    await settle()
    await settle()
    await act(async () => { document.querySelector('button[title="在新标签打开并打印"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const blob = createObjectURL.mock.calls[0]![0]
    const doc = await blob.text()
    expect(doc).toContain('<!doctype html>')
    expect(doc).toContain('<table><thead><tr><th>a</th><th>b</th></tr></thead>')
    expect(doc).toContain('<title>报告</title>')
  })
})
