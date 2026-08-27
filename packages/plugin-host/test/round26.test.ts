import { describe, expect, it } from 'vitest'
import { PluginHost } from '../src/host-runtime.js'

class Host extends PluginHost<Record<string, never>> {
  /** Supplies an explicit unbounded test policy. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }
}

class Round26Date extends Date {
  readTime(): number {
    return this.getTime()
  }
}

class Round26RegExp extends RegExp {
  readSource(): string {
    return this.source
  }
}

class Round26Map extends Map<string, number> {
  readValue(): number | undefined {
    return this.get('value')
  }
}

class Round26Set extends Set<string> {
  hasValue(): boolean {
    return this.has('value')
  }
}

/** Install one config snapshot and return its readonly root. */
const installConfig = async (
  config: Record<string, unknown>,
  update?: () => void
): Promise<any> => {
  const host = new Host()
  await host.use({ name: 'round26', config, install: () => ({}), update } as never)
  return host
}

describe('PH-R36: COW custom prototype root-reacher edges', () => {
  it('PH-T36a: rebases ordinary custom prototype root cycles while sharing unreachable subtrees', async () => {
    const ancestor = { value: 11 }
    const stable = { nested: { value: 1 } }
    const prototype: any = {
      root: undefined,
      ancestor: undefined,
      self: undefined,
      read(this: { value: number }): number {
        return this.value
      }
    }
    prototype.self = prototype
    const source: any = Object.create(prototype)
    source.value = 7
    const config: any = {
      branch: source,
      branchAlias: source,
      ancestor,
      ancestorAlias: ancestor,
      stable,
      self: undefined,
      unrelated: { changed: false }
    }
    config.self = config
    prototype.root = config
    prototype.ancestor = ancestor

    const host = await installConfig(config)
    const previous: any = host.config.get('round26')
    const previousPrototype: any = Object.getPrototypeOf(previous.branch)
    await host.config.update('round26', () => ({ unrelated: { changed: true } }))

    const next: any = host.config.get('round26')
    const nextPrototype: any = Object.getPrototypeOf(next.branch)
    expect(next).not.toBe(previous)
    expect(next.branch).not.toBe(previous.branch)
    expect(next.branch).toBe(next.branchAlias)
    expect(nextPrototype).not.toBe(previousPrototype)
    expect(nextPrototype).toBe(Object.getPrototypeOf(next.branchAlias))
    expect(nextPrototype.root).toBe(next)
    expect(nextPrototype.ancestor).toBe(next.ancestor)
    expect(nextPrototype.self).toBe(nextPrototype)
    expect(next.branch.read()).toBe(7)
    expect(next.self).toBe(next)
    expect(next.ancestor).toBe(previous.ancestor)
    expect(next.ancestor).toBe(next.ancestorAlias)
    expect(next.stable).toBe(previous.stable)
    expect(next.stable.nested).toBe(previous.stable.nested)
    expect(() => Reflect.ownKeys(nextPrototype)).not.toThrow()
    expect(() => Object.getOwnPropertyDescriptor(nextPrototype, 'root')).not.toThrow()
    expect(Object.isExtensible(nextPrototype)).toBe(true)
    expect(Object.getPrototypeOf(nextPrototype)).toBe(Object.prototype)
    expect(() => {
      nextPrototype.ancestor.value = 12
    }).toThrow('config is readonly')
  })

  it('PH-T36b: failed updates leave old prototype root aliases and readonly identity untouched', async () => {
    const failure = new Error('PH-T36b update failure')
    const prototype: any = { root: undefined, self: undefined }
    prototype.self = prototype
    const source: any = Object.create(prototype)
    const config: any = { source, stable: { value: 1 }, self: undefined }
    config.self = config
    prototype.root = config
    const host = await installConfig(config, () => {
      throw failure
    })
    const previous: any = host.config.get('round26')
    const previousPrototype: any = Object.getPrototypeOf(previous.source)

    await expect(host.config.update('round26', () => ({ stable: { value: 2 } }))).rejects.toBe(
      failure
    )

    const afterFailure: any = host.config.get('round26')
    expect(afterFailure).toBe(previous)
    expect(Object.getPrototypeOf(afterFailure.source)).toBe(previousPrototype)
    expect(previousPrototype.root).toBe(previous)
    expect(previousPrototype.self).toBe(previousPrototype)
    expect(afterFailure.stable.value).toBe(1)
  })

  it('PH-T36c: rebases Date/RegExp/Map/Set subclass prototype cycles without cloning intrinsic parents', async () => {
    const ancestor = { value: 13 }
    const stable = { nested: { value: 2 } }
    const date = new Round26Date(0)
    const regexp = new Round26RegExp('value', 'g')
    const map = new Round26Map([['value', 1]])
    const set = new Round26Set(['value'])
    const config: any = {
      date,
      dateAlias: date,
      regexp,
      regexpAlias: regexp,
      map,
      mapAlias: map,
      set,
      setAlias: set,
      ancestor,
      shared: stable,
      stable,
      self: undefined
    }
    config.self = config
    for (const prototype of [
      Round26Date.prototype,
      Round26RegExp.prototype,
      Round26Map.prototype,
      Round26Set.prototype
    ] as any[]) {
      prototype.root = config
      prototype.ancestor = ancestor
      prototype.self = prototype
    }

    const host = await installConfig(config)
    const previous: any = host.config.get('round26')
    await host.config.update('round26', () => ({ stable: { nested: { value: 3 } } }))
    const next: any = host.config.get('round26')

    for (const [key, alias] of [
      ['date', 'dateAlias'],
      ['regexp', 'regexpAlias'],
      ['map', 'mapAlias'],
      ['set', 'setAlias']
    ]) {
      const value: any = next[key]
      const previousValue: any = previous[key]
      const prototype: any = Object.getPrototypeOf(value)
      expect(value).not.toBe(previousValue)
      expect(value).toBe(next[alias])
      expect(prototype).toBe(Object.getPrototypeOf(next[alias]))
      expect(prototype).not.toBe(Object.getPrototypeOf(previousValue))
      expect(prototype.root).toBe(next)
      expect(prototype.ancestor).toBe(next.ancestor)
      expect(prototype.self).toBe(prototype)
    }

    expect(next.date.readTime()).toBe(0)
    expect(next.regexp.readSource()).toBe('value')
    expect(next.map.readValue()).toBe(1)
    expect(next.set.hasValue()).toBe(true)
    expect(Object.getPrototypeOf(Object.getPrototypeOf(next.date))).toBe(Date.prototype)
    expect(Object.getPrototypeOf(Object.getPrototypeOf(next.regexp))).toBe(RegExp.prototype)
    expect(Object.getPrototypeOf(Object.getPrototypeOf(next.map))).toBe(Map.prototype)
    expect(Object.getPrototypeOf(Object.getPrototypeOf(next.set))).toBe(Set.prototype)
    expect(next.shared).toBe(previous.shared)
    expect(next.shared.nested).toBe(previous.shared.nested)
    expect(() => next.date.setTime(1)).toThrow('config is readonly')
    expect(() => next.map.set('other', 2)).toThrow('config is readonly')
    expect(() => next.set.add('other')).toThrow('config is readonly')
  })
})
