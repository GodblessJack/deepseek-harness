/**
 * The canvas panel and card props. The target slots — 'details' (ui-layout)
 * and 'tool.call.toolview' (ui-tool) — are declared and typed by those
 * packages; the type-only imports pull their SlotMap and owner props merges.
 * The inject face carries the Session-bound canvas controller.
 * @module @deepseek-ai/dsh-client-ui-canvas/client/slots
 */

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { CanvasController } from './controller.ts'

/** Injected business face shared by the panel and the card. */
export interface CanvasInjected {
  /** The owning Session's canvas controller. */
  canvas: CanvasController
}

/** Full props of the details-column canvas panel entry. */
export type CanvasPanelProps =
  PropsRuntime<'details'>
  & InjectFace<CanvasInjected>

/** Full props of the tool-call-view canvas card entry. */
export type CanvasCardProps =
  ToolCallOwnerProps
  & InjectFace<CanvasInjected>
