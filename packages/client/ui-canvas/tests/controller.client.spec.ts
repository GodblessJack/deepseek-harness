// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { CanvasRemote } from '../src/client/controller.ts'
import { CanvasController } from '../src/client/controller.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

const sessionId = 'sess-1' as SessionId

type Script = {
  state?: (request: unknown) => Promise<unknown>
  get?: (request: unknown) => Promise<unknown>
  select?: (request: unknown) => Promise<unknown>
  demo?: (request: unknown) => Promise<unknown>
}

/**
 * A recording fake Remote. Scripts return the business result; the fake wraps
 * each call in the RemoteResult envelope the generated face uses.
 */
function fakeRemote(script: Script = {}): CanvasRemote & { calls: { method: string; request: unknown }[] } {
  const calls: { method: string; request: unknown }[] = []
  const record = (method: keyof Script, real: Script[keyof Script], fallback: unknown) =>
    async (request: unknown): Promise<unknown> => {
      calls.push({ method, request })
      return real !== undefined ? await real(request) : fallback
    }
  const remote: CanvasRemote = {
    state: record('state', script.state, { ok: true, value: { artifacts: [], selected: null, rev: 0 } }) as CanvasRemote['state'],
    get: record('get', script.get, { ok: true, value: { ok: true, artifact: null, message: '' } }) as CanvasRemote['get'],
    select: record('select', script.select, { ok: true, selected: null, message: '已选中' }) as CanvasRemote['select'],
    demo: record('demo', script.demo, { ok: true, message: '已填入 2 个示例作品' }) as CanvasRemote['demo'],
  }
  return Object.assign(remote, { calls })
}

describe('CanvasController', () => {
  it('poll unwraps the RemoteResult success value', async () => {
    const remote = fakeRemote({
      state: async () => ({ ok: true, value: { artifacts: [], selected: 'a1', rev: 2 } }),
    })
    const controller = new CanvasController(remote, sessionId)
    const result = await controller.poll()
    expect(result).toEqual({ ok: true, view: { artifacts: [], selected: 'a1', rev: 2 } })
    expect(remote.calls[0]).toEqual({ method: 'state', request: { sessionId } })
  })

  it('poll surfaces a carrier failure message', async () => {
    const remote = fakeRemote({
      state: async () => ({ ok: false, error: { code: 'transport', message: 'route down', details: {} } }),
    })
    const controller = new CanvasController(remote, sessionId)
    const result = await controller.poll()
    expect(result).toEqual({ ok: false, message: 'route down' })
  })

  it('loadContent fetches the full artifact through the get Remote', async () => {
    const artifact = { id: 'a1', title: '报告', kind: 'markdown', content: '# hi', updatedAt: '2026-09-05T00:00:00Z' }
    const remote = fakeRemote({
      get: async () => ({ ok: true, value: { ok: true, artifact, message: '' } }),
    })
    const controller = new CanvasController(remote, sessionId)
    const result = await controller.loadContent('a1')
    expect(result).toEqual({ ok: true, artifact })
    expect(remote.calls[0]).toEqual({ method: 'get', request: { sessionId, id: 'a1' } })
  })

  it('loadContent surfaces an unknown artifact message', async () => {
    const remote = fakeRemote({
      get: async () => ({ ok: true, value: { ok: false, artifact: null, message: '作品不存在' } }),
    })
    const controller = new CanvasController(remote, sessionId)
    const result = await controller.loadContent('a9')
    expect(result).toEqual({ ok: false, message: '作品不存在' })
  })

  it('openArtifact selects the artifact', async () => {
    const select = vi.fn(async () => ({ ok: true, selected: 'a1', message: '已选中' }))
    const remote = fakeRemote({ select })
    const controller = new CanvasController(remote, sessionId)
    await controller.openArtifact('a1')
    expect(select).toHaveBeenCalledWith({ sessionId, id: 'a1' })
  })

  it('fillDemo calls the demo Remote', async () => {
    const demo = vi.fn(async () => ({ ok: true, message: 'ok' }))
    const remote = fakeRemote({ demo })
    const controller = new CanvasController(remote, sessionId)
    await controller.fillDemo()
    expect(demo).toHaveBeenCalledWith({ sessionId })
  })
})
