/**
 * Conversation-flow card for one canvas tool call: title, kind, and size,
 * clickable to open that artifact in the right-side panel.
 * @module @deepseek-ai/dsh-client-ui-canvas/client/CanvasCard
 */

import { type ReactNode } from 'react'
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { CanvasCardProps } from './slots.ts'
import css from './CanvasCard.module.css'

/** One settled artifact identity parsed from the tool result message. */
interface ParsedCard {
  readonly title: string
  readonly kind: string
  readonly len: number
  readonly id: string
}

/** Parse the canvas tool's settled text result into a card model. */
export function parseCanvasCard(block: ToolCallBlock): ParsedCard | null {
  if (!('kind' in block)) return null
  const result = block
  const text = result.content
    .map((c: ContentBlock) => (c.type === 'text' ? c.text : ''))
    .join(' ')
  const m = /「([^」]+)」\[([\w-]+)\] \((\d+) 字符, id=([A-Za-z0-9]+)\)/.exec(text)
  if (m === null || m[1] === undefined || m[2] === undefined || m[3] === undefined || m[4] === undefined) {
    return null
  }
  const len = Number(m[3])
  return { title: m[1], kind: m[2], len, id: m[4] }
}

/**
 * CanvasCard component. Clicking selects the artifact; the canvas itself is
 * the conversation's '画布' view tab, so the card selects and the user chooses
 * when to switch views.
 */
export function CanvasCard({ block, canvas }: CanvasCardProps): ReactNode {
  const controller = canvas
  const parsed = parseCanvasCard(block)

  const kindLabel = parsed !== null ? parsed.kind : '…'
  const sub = parsed !== null ? `${parsed.kind} · ${parsed.len} 字符` : '写入中…'

  return (
    <button
      type="button"
      className={css.card}
      disabled={parsed === null}
      onClick={() => {
        if (parsed === null) return
        void controller.openArtifact(parsed.id)
      }}
      title={parsed !== null ? '点击选中;到「画布」页查看' : '正在写入…'}
    >
      <span className={css.ico}>{kindLabel.slice(0, 1).toUpperCase()}</span>
      <span className={css.main}>
        <span className={css.title}>{parsed !== null ? parsed.title : '画布'}</span>
        <span className={css.sub}>{sub}</span>
      </span>
      {parsed !== null ? <span className={css.open}>↗</span> : null}
    </button>
  )
}
