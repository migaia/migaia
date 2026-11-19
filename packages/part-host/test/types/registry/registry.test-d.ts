import type { IEffectContext, IPartHost } from '../../../src/index.ts'

declare module '../../../src/registry.ts' {
  interface IPartTypeRegistry {
    addresses: 'page/dialog'
    states: { 'page.form.customer': string }
    events: { 'page/dialog': { 'app:pick': { id: string } } }
    resources: {
      'orders@1': {
        params: { status: 'open' }
        result: unknown
        commands: { create: { customer: string } }
      }
    }
  }
}

/** Calls checked against the merged registry; each wrong call has a legal counterpart above it. */
export function check(ctx: IEffectContext<Record<string, unknown>>, host: IPartHost): void {
  /** Customer name, typed from the registry. */
  const customer: string = ctx.state.read('page.form.customer')
  // @ts-expect-error the registered type of page.form.customer is string
  const wrong: number = ctx.state.read('page.form.customer')
  ctx.part('page/dialog')
  // @ts-expect-error unknown address
  ctx.part('page/x')
  void host.resources.query('orders@1', { status: 'open' })
  // @ts-expect-error status outside the registered params
  void host.resources.query('orders@1', { status: 'lost' })
  void host.resources.run('orders@1', 'create', { customer: 'A' })
  // @ts-expect-error missing customer
  void host.resources.run('orders@1', 'create', {})
  ctx.dispatch('page/dialog', 'app:pick', { id: '1' })
  ctx.dispatch('page/dialog', 'close', undefined)
  // @ts-expect-error id must be a string
  ctx.dispatch('page/dialog', 'app:pick', { id: 1 })
  ctx.part('page/dialog').dispatch('app:pick', { id: '1' })
  // @ts-expect-error id must be a string
  ctx.part('page/dialog').dispatch('app:pick', { id: 1 })
  void customer
  void wrong
}
