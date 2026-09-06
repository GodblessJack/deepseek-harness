// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import { parseCanvasCard } from '../src/client/CanvasCard.tsx'

function settledResult(text: string): Parameters<typeof parseCanvasCard>[0] {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 1,
    callId: 'call-1',
    call: { name: 'canvas', argsRaw: '{}' },
    callTime: 1,
    content: [{ type: 'text', text }] as ContentBlock[],
    isError: false,
    callView: null,
    resultView: null,
    subCalls: [],
  }
}

describe('parseCanvasCard', () => {
  it('parses a settled write result into a card model', () => {
    const block = settledResult('画布已更新: 「西安画册」[html] (13045 字符, id=a1), 已展示在右侧画布。')
    expect(parseCanvasCard(block)).toEqual({ title: '西安画册', kind: 'html', len: 13045, id: 'a1' })
  })

  it('returns null for a running call (no kind)', () => {
    expect(parseCanvasCard({ callId: 'c', name: 'canvas', argsRaw: '{}', turn: 1, step: 1, time: 1, callView: null, subCalls: [] }))
      .toBeNull()
  })

  it('returns null when the message carries no artifact identity', () => {
    expect(parseCanvasCard(settledResult('画布已清空'))).toBeNull()
  })
})
