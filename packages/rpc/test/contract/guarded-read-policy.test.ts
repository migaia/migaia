import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { normalizeRpcSerializedError, serializeRpcError } from '../../src/contract/index.js'

describe('contract guarded property policy', () => {
  it('reports one failed stack read and marks the wire node truncated', () => {
    const failure = new Error('stack failed')
    const reads = new Map<PropertyKey, number>()
    const target = new Proxy(new Error('original'), {
      get(object, key, receiver) {
        reads.set(key, (reads.get(key) ?? 0) + 1)
        if (key === 'stack') throw failure
        return Reflect.get(object, key, receiver)
      }
    })
    const reported: unknown[] = []
    const wire = serializeRpcError(target, { report: (event) => reported.push(event) })
    expect(wire.truncated).toBe(true)
    expect(reported).toEqual([{ pointer: '', field: 'stack', error: failure }])
    expect([...reads]).toEqual([
      ['name', 1],
      ['message', 1],
      ['stack', 1],
      ['source', 1],
      ['code', 1],
      ['data', 1],
      ['truncated', 1],
      ['cause', 1],
      ['errors', 1],
      ['cleanupErrors', 1]
    ])
  })

  it('[A107] forwarding metadata adds no own-property trap to ordinary errors', () => {
    /** Original error serialization reads fixed fields, never unrelated own descriptors. */
    let ownReads = 0
    /** The proxy is an ordinary supported thrown error with no package-minted route. */
    const original = new Proxy(new Error('ordinary-route-free'), {
      getOwnPropertyDescriptor(target, key) {
        ownReads += 1
        return Reflect.getOwnPropertyDescriptor(target, key)
      }
    })
    /** A new diagnostic property must not alter ordinary business error admission. */
    const wire = serializeRpcError(original, { report: () => undefined })
    expect(wire.message).toBe('ordinary-route-free')
    expect(ownReads).toBe(0)
  })

  it('throws INVALID_WIRE_ERROR with the hostile field read as cause', () => {
    const failure = new Error('message failed')
    let reads = 0
    const wire = {
      source: '@test',
      code: 'TEST',
      name: 'Error',
      get message(): never {
        reads += 1
        throw failure
      },
      stack: 'Error: test'
    }
    let thrown: unknown
    try {
      normalizeRpcSerializedError(wire)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(TypeError)
    expect(thrown).toMatchObject({
      code: 'INVALID_WIRE_ERROR',
      pointer: '/message',
      violation: 'read',
      cause: failure
    })
    expect(reads).toBe(1)
  })

  it('keeps hostile errors-array reads at their exact wire pointers', () => {
    const failure = new Error('array read failed')
    const base = { source: '@test', code: 'TEST', name: 'Error', message: 'test', stack: 'stack' }
    for (const [key, pointer] of [
      ['length', '/errors/length'],
      ['0', '/errors/0']
    ] as const) {
      const errors = new Proxy([base], {
        get(target, property, receiver) {
          if (property === key) throw failure
          return Reflect.get(target, property, receiver)
        }
      })
      let thrown: unknown
      try {
        normalizeRpcSerializedError({ ...base, errors })
      } catch (error) {
        thrown = error
      }
      expect(thrown).toMatchObject({
        code: 'INVALID_WIRE_ERROR',
        pointer,
        violation: 'read',
        cause: failure
      })
    }
  })

  it('reports a failed cleanup-entry read without losing the root', () => {
    const failure = new Error('cleanup read failed')
    const reported: unknown[] = []
    const wire = serializeRpcError(
      {
        name: 'Error',
        message: 'test',
        stack: 'stack',
        cleanupErrors: [
          {
            get error(): never {
              throw failure
            }
          }
        ]
      },
      { report: (event) => reported.push(event) }
    )
    expect(wire.truncated).toBe(true)
    expect(reported).toContainEqual({ pointer: '/cleanupErrors/0', field: 'error', error: failure })
  })

  it('reports an errors-array length trap and skips primitive cleanup entries', () => {
    const failure = new Error('length failed')
    const reported: unknown[] = []
    const errors = new Proxy([new Error('child')], {
      get(target, key, receiver) {
        if (key === 'length') throw failure
        return Reflect.get(target, key, receiver)
      }
    })
    const wire = serializeRpcError(
      {
        name: 'Error',
        message: 'root',
        stack: 'stack',
        errors,
        cleanupErrors: [null, { error: new Error('cleanup') }]
      },
      { report: (event) => reported.push(event) }
    )
    expect(wire.truncated).toBe(true)
    expect(reported).toContainEqual({ pointer: '', field: 'length', error: failure })
    expect(wire.errors).toHaveLength(1)
  })

  it('serializes an error from another realm', () => {
    const crossRealm = runInNewContext('new Error("remote")') as Error
    const wire = serializeRpcError(crossRealm, { report: () => undefined })
    expect(wire).toMatchObject({
      name: 'Error',
      message: 'remote',
      stack: expect.stringContaining('Error: remote')
    })
  })
})
