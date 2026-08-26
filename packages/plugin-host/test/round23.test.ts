import { describe, expect, it } from 'vitest'
import { PluginHost } from '../src/host-runtime.js'

class Host extends PluginHost<Record<string, never>> {}

/** Install one config callable and return its readonly value. */
const installCallable = async (value: unknown): Promise<any> => {
  const host = new Host()
  await host.use({
    name: 'round23',
    config: { value },
    install: () => ({})
  } as never)
  return host.config.get('round23.value')
}

describe('PH-R32: owned readonly prototype graphs', () => {
  it('PH-T30a: owns Object.create prototype graphs, nested values, cycles, identity, and methods', async () => {
    const nested = { value: 1 }
    const prototype = {
      nested,
      read(this: { value: number }): number {
        return this.value
      }
    }
    ;(prototype as { self?: unknown }).self = prototype
    const source = Object.create(prototype) as { value: number }
    source.value = 7
    const host = new Host()
    await host.use({ name: 'prototype-graph', config: { source }, install: () => ({}) } as never)

    const view: any = host.config.get('prototype-graph.source')
    const readonlyPrototype = Object.getPrototypeOf(view)
    expect(readonlyPrototype).not.toBe(prototype)
    expect(Object.getPrototypeOf(view)).toBe(readonlyPrototype)
    expect(readonlyPrototype.nested).not.toBe(nested)
    expect(readonlyPrototype.self).toBe(readonlyPrototype)
    expect(view.read()).toBe(7)
    expect(() => {
      readonlyPrototype.nested.value = 2
    }).toThrow('readonly')

    nested.value = 3
    expect(view.nested.value).toBe(1)
    expect(view.read()).toBe(7)
  })

  it('PH-T30b: keeps null/Object prototype boundaries safe and preserves callable constructor semantics', async () => {
    const nullPrototype = Object.create(null) as { value: number }
    nullPrototype.value = 1
    const ConfigClass = function (this: { value: number }, value: number): void {
      this.value = value
    }
    ConfigClass.prototype.read = function (this: { value: number }): number {
      return this.value
    }
    const host = new Host()
    await host.use({
      name: 'prototype-boundaries',
      config: {
        nullPrototype,
        ctor: ConfigClass
      },
      install: () => ({})
    } as never)

    const nullView: any = host.config.get('prototype-boundaries.nullPrototype')
    expect(Object.getPrototypeOf(nullView)).toBeNull()

    const readonlyConstructor: any = host.config.get('prototype-boundaries.ctor')
    const instance: any = new readonlyConstructor(4)
    expect(instance.read()).toBe(4)
    expect(instance instanceof readonlyConstructor).toBe(true)
    expect(Object.getPrototypeOf(instance)).not.toBe(ConfigClass.prototype)
    expect(Object.getPrototypeOf(readonlyConstructor.prototype)).not.toBe(ConfigClass.prototype)
    expect(() => {
      readonlyConstructor.prototype.read = () => 0
    }).toThrow('readonly')
  })

  it('PH-T30c: callable output exposes repeated readonly prototype facades without raw nested values', async () => {
    const nested = { value: 1 }
    const prototype = {
      nested,
      read(this: { value: number }): number {
        return this.value
      }
    }
    const source = Object.create(prototype) as { value: number }
    source.value = 5
    const readonlyCallable = await installCallable(() => source)
    const output: any = readonlyCallable()
    const readonlyPrototype = Object.getPrototypeOf(output)

    expect(readonlyPrototype).not.toBe(prototype)
    expect(Object.getPrototypeOf(output)).toBe(readonlyPrototype)
    expect(readonlyPrototype.nested).not.toBe(nested)
    expect(output.read()).toBe(5)
    expect(() => {
      readonlyPrototype.nested.value = 2
    }).toThrow('readonly')
  })
})

describe('PH-R33: structural iterator classification', () => {
  it('PH-T31a: does not read hostile own/inherited next or protocol getters during admission', async () => {
    const nextMarker = new Error('PH-T31a next marker')
    const iteratorMarker = new Error('PH-T31a iterator marker')
    const asyncMarker = new Error('PH-T31a async marker')
    let nextReads = 0
    let iteratorReads = 0
    let asyncReads = 0
    const prototype = {}
    Object.defineProperties(prototype, {
      next: {
        configurable: true,
        get(): never {
          nextReads += 1
          throw nextMarker
        }
      },
      [Symbol.iterator]: {
        configurable: true,
        get(): never {
          iteratorReads += 1
          throw iteratorMarker
        }
      },
      [Symbol.asyncIterator]: {
        configurable: true,
        get(): never {
          asyncReads += 1
          throw asyncMarker
        }
      }
    })
    const inherited = Object.create(prototype)
    const own = {}
    Object.defineProperty(own, 'next', {
      configurable: true,
      get(): never {
        nextReads += 1
        throw nextMarker
      }
    })
    const readonlyInherited: any = await installCallable(() => inherited)
    const readonlyOwn: any = await installCallable(() => own)

    expect(nextReads).toBe(0)
    expect(iteratorReads).toBe(0)
    expect(asyncReads).toBe(0)
    expect(() => readonlyInherited().next).toThrow(nextMarker)
    expect(() => readonlyInherited()[Symbol.iterator]).toThrow(iteratorMarker)
    expect(() => readonlyInherited()[Symbol.asyncIterator]).toThrow(asyncMarker)
    expect(() => readonlyOwn().next).toThrow(nextMarker)
    expect(nextReads).toBe(2)
    expect(iteratorReads).toBe(1)
    expect(asyncReads).toBe(1)
  })

  it('PH-T31b: admits genuine data-descriptor iterators lazily and preserves receiver/output mapping', async () => {
    const value = { value: 1 }
    let nextCalls = 0
    let receiverMatched = false
    type ITestIterator = {
      next(this: object): IteratorResult<typeof value>
      [Symbol.iterator](this: object): ITestIterator
    }
    const iterator: ITestIterator = {
      next(this: object): IteratorResult<typeof value> {
        receiverMatched = this === iterator
        nextCalls += 1
        return nextCalls === 1 ? { done: false, value } : { done: true, value }
      },
      [Symbol.iterator](this: object): typeof iterator {
        receiverMatched = this === iterator
        return iterator
      }
    }
    const readonlyIterator: any = (await installCallable(() => iterator))()

    expect(nextCalls).toBe(0)
    expect(readonlyIterator[Symbol.iterator]()).toBe(readonlyIterator)
    const first = readonlyIterator.next()
    expect(nextCalls).toBe(1)
    expect(receiverMatched).toBe(true)
    expect(first.value).not.toBe(value)
    expect(() => {
      first.value.value = 2
    }).toThrow('readonly')
  })
})
