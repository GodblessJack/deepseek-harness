/**
 * The canvas view and card props. The targets — the 'conversation.view' slot
 * (ui-conversation, the third tab beside Chat and Trajectory) and
 * 'tool.call.toolview' (ui-tool, the in-flow card) — are declared and typed by
 * those packages; the type-only imports pull their SlotMap and owner props
 * merges. The inject face carries the Session-bound canvas controller.
 * @module @deepseek-ai/dsh-client-ui-canvas/client/slots
 */

import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ToolCallOwnerProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { CanvasController } from './controller.ts'

/** Injected business face shared by the canvas view and the card. */
export interface CanvasInjected {
  /** The owning Session's canvas controller. */
  canvas: CanvasController
}

/** Full props of the conversation-view canvas tab entry. */
export type CanvasPanelProps =
  PropsRuntime<'conversation.view'>
  & InjectFace<CanvasInjected>

/** Full props of the tool-call-view canvas card entry. */
export type CanvasCardProps =
  ToolCallOwnerProps
  & InjectFace<CanvasInjected>
