/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-canvas/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-canvas'

/** Cordis companion plugin name. */
export const name = 'canvas-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the canvas service owns every mutation, the domain
 * schema validates bucket rows on reopen, and no second authority exists.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['canvas'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
