import type { IEffectContext, IPartHost } from '@migaia/part-host'

/** Without a generated file every address, path and resource id is a plain string. */
export function check(ctx: IEffectContext<Record<string, unknown>>, host: IPartHost): void {
  ctx.part('any/address').dispatch('anything', 1)
  void ctx.state.read('whatever.path')
  void host.resources.query('any@1', {})
}
