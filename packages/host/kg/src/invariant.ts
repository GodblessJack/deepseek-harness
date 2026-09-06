/** Package-owned invariant companion. @module @deepseek-ai/dsh-host-kg/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-kg'

/** Cordis companion plugin name. */
export const name = 'kg-invariant'
/** Services required before the companion can reserve and check package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the kg service owns no durable state of its own — the
 * assembled artifact lives in the canvas domain and every fetch outcome is
 * reported in the tool's result text, so no second authority exists to check.
 */
const install: InvariantInstaller = Object.assign(() => {}, { inject: ['kg'] })

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
