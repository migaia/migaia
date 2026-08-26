import { describe, expect, it } from 'vitest'
import { PluginHost } from '../src/host-runtime.js'

type ICallableParent = ((value: number) => { value: number }) & {
  marker: string
  shared: { value: number }
  root: Record<string, unknown>
  self: ICallableParent
}

type IPropertyOrder = 'parent-first' | 'child-first'

class Host extends PluginHost<Record<string, never>> {}

/** Build the callable parent and child prototype graph in one requested property order. */
const createConfig = (order: IPropertyOrder): Record<string, unknown> => {
  const shared = { value: 1 }
  const parentFn = function (
    this: { value?: number } | undefined,
    value: number
  ): { value: number } {
    if (this !== undefined) {
      this.value = value
      return this as { value: number }
    }
    return { value }
  } as ICallableParent
  parentFn.marker = 'callable-parent'
  parentFn.shared = shared
  parentFn.self = parentFn
  parentFn.prototype.read = function (this: { value: number }): number {
    return this.value
  }

  const childWithProtoParentFn = Object.create(parentFn) as Record<string, unknown>
  childWithProtoParentFn.childValue = 7
  const config = (
    order === 'parent-first'
      ? { parentFn, childWithProtoParentFn, childAlias: childWithProtoParentFn, shared }
      : { childWithProtoParentFn, childAlias: childWithProtoParentFn, parentFn, shared }
  ) as Record<string, unknown>
  config.self = config
  childWithProtoParentFn.root = config
  parentFn.root = config
  return config
}

/** Install one Round28 config, optionally adding an update hook failure. */
const installConfig = async (
  name: string,
  config: Record<string, unknown>,
  update?: () => void
): Promise<Host> => {
  const host = new Host()
  await host.use({ name, config, install: () => ({}), update } as never)
  return host
}

describe('PH-R38: callable cached prototype ownership', () => {
  it('PH-T38a: preserves callable parent alias and child prototype identity for both property orders', async () => {
    for (const order of ['parent-first', 'child-first'] as const) {
      const config = createConfig(order)
      const host = await installConfig(`round28-${order}`, config)
      const root: any = host.config.get(`round28-${order}`)
      const parent: any = root.parentFn
      const child: any = root.childWithProtoParentFn

      expect(typeof parent).toBe('function')
      expect(root.childAlias).toBe(child)
      expect(Object.getPrototypeOf(child)).toBe(parent)
      expect(Object.getPrototypeOf(child)).not.toBe(config.parentFn)
      expect(child.marker).toBe('callable-parent')
      expect(child.shared.value).toBe(1)
      expect(Object.getPrototypeOf(config.parentFn)).toBe(Function.prototype)
      expect(Object.getPrototypeOf(child)).not.toBe(Function.prototype)
      expect(() => {
        child.shared.value = 2
      }).toThrow('config is readonly')
      expect(parent(3)).toEqual({ value: 3 })
      const instance: any = new parent(4)
      expect(instance.value).toBe(4)
      expect(instance.read()).toBe(4)
      expect(Object.getPrototypeOf(parent)).not.toBe(config.parentFn)
      expect(Object.getPrototypeOf(Object.getPrototypeOf(child))).not.toBe(config.parentFn)
      expect(Object.getPrototypeOf(child)).toBe(Object.getPrototypeOf(child))
    }
  })

  it('PH-T38b: rebases callable parent root cycles while preserving aliases and stable subtrees', async () => {
    const config = createConfig('child-first')
    const stable = { nested: { value: 9 } }
    config.stable = stable
    const host = await installConfig('round28-cow', config)
    const previous: any = host.config.get('round28-cow')
    const previousParent: any = previous.parentFn

    await host.config.update('round28-cow', () => ({ changed: true }))

    const next: any = host.config.get('round28-cow')
    expect(next).not.toBe(previous)
    expect(next.parentFn).toBe(
      next.childWithProtoParentFn && Object.getPrototypeOf(next.childWithProtoParentFn)
    )
    expect(next.parentFn.root).toBe(next)
    expect(next.parentFn.self).toBe(next.parentFn)
    expect(next.childWithProtoParentFn.root).toBe(next)
    expect(next.self).toBe(next)
    expect(next.stable).toBe(previous.stable)
    expect(next.stable.nested).toBe(previous.stable.nested)
    expect(next.parentFn).not.toBe(previousParent)
    const nextParent: any = next.parentFn
    expect(nextParent(5)).toEqual({ value: 5 })
  })

  it('PH-T38c: failed update rolls back callable parent and child prototype identities', async () => {
    const failure = new Error('PH-T38c update failure')
    const config = createConfig('parent-first')
    const host = await installConfig('round28-rollback', config, () => {
      throw failure
    })
    const previous: any = host.config.get('round28-rollback')
    const previousParent: any = previous.parentFn
    const previousChild: any = previous.childWithProtoParentFn
    const previousReadonlyPrototype = Object.getPrototypeOf(previousChild)

    await expect(host.config.update('round28-rollback', () => ({ changed: true }))).rejects.toBe(
      failure
    )

    const afterFailure: any = host.config.get('round28-rollback')
    expect(afterFailure).toBe(previous)
    expect(afterFailure.parentFn).toBe(previousParent)
    expect(afterFailure.childWithProtoParentFn).toBe(previousChild)
    expect(Object.getPrototypeOf(afterFailure.childWithProtoParentFn)).toBe(
      previousReadonlyPrototype
    )
    expect(afterFailure.changed).toBeUndefined()
    expect(previousParent.root).toBe(previous)
    expect(previousParent.self).toBe(previousParent)
    expect(previousParent(6)).toEqual({ value: 6 })
    const instance: any = new previousParent(8)
    expect(instance.read()).toBe(8)
  })
})
