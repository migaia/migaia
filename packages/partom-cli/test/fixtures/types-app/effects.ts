import type { IEffectContext, IPartHost } from '@migaia/part-host'

/** Calls checked against the generated registry; every wrong call has a legal counterpart. */
export function check(ctx: IEffectContext<Record<string, unknown>>, host: IPartHost): void {
  ctx.part('page/dialog')
  // @ts-expect-error unknown address
  ctx.part('page/missing')
  /** Customer name typed as string. */
  const customer: string | undefined = ctx.state.read('page.form.customer')
  // @ts-expect-error the value is a string
  const wrong: number = ctx.state.read('page.form.customer')
  void host.resources.query('orders@1', { status: 'open' })
  // @ts-expect-error status outside the enum
  void host.resources.query('orders@1', { status: 'lost' })
  void host.resources.run('orders@1', 'create', { customer: 'A' })
  // @ts-expect-error customer is required
  void host.resources.run('orders@1', 'create', {})
  ctx.part('page/rows/cell@row:1')
  // @ts-expect-error not a template row address
  ctx.part('page/other@row:1')
  ctx.dispatch('page/dialog', 'app:pick', { id: '1' })
  // @ts-expect-error id must be a string
  ctx.dispatch('page/dialog', 'app:pick', { id: 1 })
  void customer
  void wrong
}
