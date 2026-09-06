/**
 * Canvas browser half: one conversation view tab ('conversation.view' entry
 * 'canvas', beside Chat and Trajectory) rendering the artifact stage, plus the
 * per-work conversation card ('tool.call.toolview' key 'canvas'). State comes
 * from the canvas Host Remote through one controller per Session.
 * @module @deepseek-ai/dsh-client-ui-canvas/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the generated Remote API and ctx.remote merge through the Client assembly boundary.
import type {} from '@deepseek-ai/dsh-api-remotes/client'
// Type-only: pulls the ui-conversation SlotMap merge (the conversation.view entry).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CanvasController } from './controller.ts'
import { CanvasPanel } from './CanvasPanel.tsx'
import { CanvasCard } from './CanvasCard.tsx'
import type { CanvasInjected } from './slots.ts'

export type {
  CanvasController, CanvasPollResult, CanvasRemote, CanvasView,
} from './controller.ts'
export type { CanvasPanelProps, CanvasCardProps, CanvasInjected } from './slots.ts'
export { CanvasPanel } from './CanvasPanel.tsx'
export { CanvasCard } from './CanvasCard.tsx'

/** Required services: slot registry, the Remote namespace, and the canvas Remote face. */
export const inject = ['slots', 'remote', 'remote.canvas']

/**
 * Client plugin body: one controller per Session wiring the canvas view tab
 * and the conversation card to the canvas Host Remote.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controllers = new Map<SessionId, CanvasController>()
  const controllerFor = (sessionId: SessionId): CanvasController => {
    let controller = controllers.get(sessionId)
    if (controller === undefined) {
      controller = new CanvasController(ctx.remote.canvas, sessionId)
      controllers.set(sessionId, controller)
    }
    return controller
  }

  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: 'canvas',
    order: 20,
    label: () => '画布',
    inject: (sessionId: SessionId): CanvasInjected => ({
      canvas: controllerFor(sessionId),
    }),
  }, CanvasPanel))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'canvas',
    inject: (sessionId: SessionId): CanvasInjected => ({
      canvas: controllerFor(sessionId),
    }),
  }, CanvasCard))
}
