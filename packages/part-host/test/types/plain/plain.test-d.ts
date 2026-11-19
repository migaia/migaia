import type { IEffectContext, IPartHost } from '../../../src/index.ts'

/** Without a generated registry every address, path and resource id is a plain string. */
export function check(ctx: IEffectContext<Record<string, unknown>>, host: IPartHost): void {
  const value: unknown = ctx.state.read('anything.at.all')
  ctx.state.write('x', 1)
  ctx.part('any/address').dispatch('any', { free: true })
  ctx.dispatch('a', 'b', 3)
  void host.resources.query('whatever@1', { a: 1 })
  void host.resources.run('whatever@1', 'cmd', null)
  void value
}
