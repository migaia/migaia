import { describe, expect, it } from 'vitest'
import { PluginHostErrorCode } from '../src/error-code.js'
import { PluginHost } from '../src/host-runtime.js'

class Host extends PluginHost<Record<string, never>> {}

type IAccessorOutput = {
  readonly nested: { value: number; self?: unknown }
}

/** Install one callable and expose its public readonly output. */
const installCallableOutput = async (callable: () => unknown): Promise<unknown> => {
  const host = new Host()
  await host.use({
    name: 'descriptor-output',
    config: { callable },
    install: () => ({})
  } as never)
  return (host.config.get('descriptor-output.callable') as () => unknown)()
}

describe('PH-T32: readonly descriptor boundary', () => {
  it('PH-T32a: callable output descriptor getters map aliases and cycles through readonly cache', async () => {
    const shared = { value: 1 } as { value: number; self?: unknown }
    shared.self = shared
    let rawOutput!: object
    const callable = (): object => {
      rawOutput = {}
      Object.defineProperty(rawOutput, 'nested', {
        configurable: false,
        enumerable: true,
        get(this: unknown): typeof shared {
          expect(this).toBe(rawOutput)
          return shared
        }
      })
      return rawOutput
    }

    const output = (await installCallableOutput(callable)) as IAccessorOutput
    const descriptor = Object.getOwnPropertyDescriptor(output, 'nested')
    const fromDescriptor = descriptor?.get?.()

    expect(fromDescriptor).toBe(output.nested)
    expect(fromDescriptor).not.toBe(shared)
    expect(fromDescriptor?.self).toBe(fromDescriptor)
  })

  it('PH-T32b: descriptor setters, deletes, and definitions reject without invoking raw setters', async () => {
    const nested = { value: 1 }
    let setterCalls = 0
    const callable = (): object => {
      const output = {}
      Object.defineProperty(output, 'nested', {
        configurable: false,
        enumerable: true,
        get: () => nested,
        set: () => {
          setterCalls += 1
        }
      })
      return output
    }

    const output = (await installCallableOutput(callable)) as IAccessorOutput
    const descriptor = Object.getOwnPropertyDescriptor(output, 'nested')

    expect(() => descriptor?.set?.({ value: 2 })).toThrow('config is readonly')
    expect(() => Reflect.set(output, 'nested', { value: 2 })).toThrow('config is readonly')
    expect(() => Reflect.deleteProperty(output, 'nested')).toThrow('config is readonly')
    expect(() => Object.defineProperty(output, 'nested', { value: { value: 2 } })).toThrow(
      'config is readonly'
    )
    expect(setterCalls).toBe(0)
    expect(nested.value).toBe(1)
  })

  it('PH-T32c: descriptor getter errors preserve exact identity and symbol/custom-prototype semantics', async () => {
    const symbolKey = Symbol('nested')
    const shared = { value: 1 }
    const getterError = new Error('descriptor getter failure')
    const prototype = {
      get inherited(): unknown {
        return (this as unknown as { nested: unknown }).nested
      }
    }
    let rawOutput!: object
    const callable = (): object => {
      rawOutput = Object.create(prototype)
      Object.defineProperties(rawOutput, {
        nested: {
          configurable: true,
          enumerable: true,
          value: shared,
          writable: true
        },
        broken: {
          configurable: false,
          enumerable: true,
          get(): never {
            throw getterError
          }
        },
        [symbolKey]: {
          configurable: false,
          enumerable: true,
          get(this: object): typeof shared {
            expect(this).toBe(rawOutput)
            return shared
          },
          set: (): void => undefined
        }
      })
      return rawOutput
    }

    const output = (await installCallableOutput(callable)) as {
      nested: { value: number }
      inherited: { value: number }
      broken: unknown
      [symbolKey]: { value: number }
    }
    const brokenDescriptor = Object.getOwnPropertyDescriptor(output, 'broken')
    const symbolDescriptor = Object.getOwnPropertyDescriptor(output, symbolKey)

    expect(() => brokenDescriptor?.get?.()).toThrow(getterError)
    expect(() => output.broken).toThrow(getterError)
    expect(Object.getPrototypeOf(output)).not.toBe(prototype)
    expect(output.inherited).toBe(output.nested)
    expect(symbolDescriptor?.get?.()).toBe(output.nested)
    expect(() => symbolDescriptor?.set?.(shared)).toThrow('config is readonly')
  })

  it('PH-T32d: rejects custom config prototype accessors before installation', async () => {
    const symbolKey = Symbol('config accessor')
    const shared = { value: 1 }
    const prototype = {}
    Object.defineProperty(prototype, symbolKey, {
      configurable: true,
      enumerable: true,
      get(this: { nested: unknown }): unknown {
        return this.nested
      },
      set: (): void => undefined
    })
    const value = Object.assign(Object.create(prototype), { nested: shared })
    const host = new Host()
    let error: unknown
    try {
      await host.use({
        name: 'descriptor-config',
        config: { value },
        install: () => ({})
      } as never)
    } catch (reason) {
      error = reason
    }

    expect(error).toBeInstanceOf(TypeError)
    expect((error as { readonly code?: unknown }).code).toBe(PluginHostErrorCode.invalidOption)
    expect(host.config.get('descriptor-config.value')).toBeUndefined()
    expect(shared.value).toBe(1)
  })
})
