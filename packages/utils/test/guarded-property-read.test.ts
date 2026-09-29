import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { tryReadProperty } from '../src/error.js'

describe('tryReadProperty', () => {
  it('returns each successful value without probing it', () => {
    const payload = { value: 7, absent: undefined }
    expect(tryReadProperty(payload, 'value')).toEqual({ threw: false, value: 7 })
    expect(tryReadProperty(payload, 'absent')).toEqual({ threw: false, value: undefined })

    let thenReads = 0
    const thenable = Object.defineProperty({}, String.fromCharCode(116, 104, 101, 110), {
      get: () => {
        thenReads += 1
        return () => undefined
      }
    })
    expect(tryReadProperty({ thenable }, 'thenable')).toEqual({ threw: false, value: thenable })
    expect(thenReads).toBe(0)

    let reads = 0
    const inherited = Object.create({
      get value() {
        expect(this).toBe(inherited)
        reads += 1
        return 8
      }
    }) as { readonly value: number }
    expect(tryReadProperty(inherited, 'value')).toEqual({ threw: false, value: 8 })
    expect(reads).toBe(1)

    const key = Symbol('value')
    expect(tryReadProperty({ [key]: thenable }, key)).toEqual({ threw: false, value: thenable })
  })

  it('returns thrown values unchanged after exactly one get', () => {
    const failure = new Error('getter failed')
    const originalStack = failure.stack
    const originalKeys = Reflect.ownKeys(failure)
    let reads = 0
    const object = {
      get value(): never {
        reads += 1
        throw failure
      }
    }
    expect(tryReadProperty(object, 'value')).toEqual({ threw: true, error: failure })
    expect(reads).toBe(1)
    expect(failure.stack).toBe(originalStack)
    expect(Reflect.ownKeys(failure)).toEqual(originalKeys)

    const stringFailure = {
      get value(): never {
        throw 's'
      }
    }
    expect(tryReadProperty(stringFailure, 'value')).toEqual({ threw: true, error: 's' })

    const traps: PropertyKey[] = []
    const proxyFailure = new Error('proxy failed')
    const proxy = new Proxy(
      { value: 0 },
      {
        get(_target, property): never {
          traps.push(property)
          throw proxyFailure
        }
      }
    )
    expect(tryReadProperty(proxy, 'value')).toEqual({ threw: true, error: proxyFailure })
    expect(traps).toEqual(['value'])
  })

  it('allows a getter to reenter without changing either read', () => {
    let reads = 0
    const object = {
      get value() {
        reads += 1
        return tryReadProperty({ nested: 9 }, 'nested')
      }
    }
    expect(tryReadProperty(object, 'value')).toEqual({
      threw: false,
      value: { threw: false, value: 9 }
    })
    expect(reads).toBe(1)
  })

  it('exports the primitive only from error and the package root', async () => {
    const [errorModule, rootModule, promiseModule, functionModule, declaration] = await Promise.all(
      [
        import('../dist/error.js'),
        import('../dist/index.js'),
        import('../dist/promise.js'),
        import('../dist/function.js'),
        readFile(new URL('../dist/error.d.ts', import.meta.url), 'utf8')
      ]
    )
    expect(errorModule.tryReadProperty).toBeTypeOf('function')
    expect(rootModule.tryReadProperty).toBe(errorModule.tryReadProperty)
    expect('tryReadProperty' in promiseModule).toBe(false)
    expect('tryReadProperty' in functionModule).toBe(false)
    expect(declaration).toContain('IPropertyRead')
  })
})
