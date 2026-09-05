/** Package invariant companion for `@deepseek-ai/dsh-workspace-upload`. */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-workspace-upload'

/** Cordis invariant-companion plugin name. */
export const name = 'workspace-upload-invariant'
/** Registry required before reserving this package's invariant ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the endpoint owns no durable events; file presence
 * is asserted by the caller.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Host context carrying the invariant registry.
 * @returns the registration disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
