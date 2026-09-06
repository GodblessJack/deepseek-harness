/**
 * dsh-hello-plugin — the `say_hello` tool as an installable bundle.
 *
 * Registers one model-facing tool on `ctx.tools` in the raw JSON-Schema
 * `ToolDefinition` form. The module has no runtime dependency beyond the
 * injected Cordis context.
 */
export const name = 'hello-tool-plugin'
export const inject = ['tools']

export function apply(ctx) {
  ctx.tools.register({
    name: 'say_hello',
    description: 'Greet a user by name. Use it when the user asks to be greeted.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the person to greet.' },
      },
      required: ['name'],
    },
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: String(value) }],
    },
    async execute(args) {
      const name = args?.name
      if (typeof name !== 'string' || name.length === 0) {
        throw new Error('say_hello: `name` must be a non-empty string')
      }
      return `Hello, ${name}!`
    },
  })
  console.log('[hello-tool-plugin] registered tool: say_hello')
}
