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
