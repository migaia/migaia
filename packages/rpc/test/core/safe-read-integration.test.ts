import { describe, expect, it } from 'vitest'
import { normalizeRpcEnvelope, reachRpcError } from '../../src/contract/index.js'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { createEndpointKernel } from '../../src/core/endpoint-kernel.js'
import { RpcConstructionError } from '../../src/core/errors.js'
import { connect } from '../../src/core/middleware/connect.js'
import { assertPluginInstallResult } from '../../src/core/internal/plugin-descriptor.js'
import { validateContractData } from '../../src/core/internal/contract.js'
import type { IRpcContractConfig } from '../../src/core/typing.js'

/** Follow the native cause chain without interpreting a reported error's shape. */
function reachesCause(value: unknown, expected: unknown): boolean {
  let current = value
  for (let index = 0; index < 8; index += 1) {
    if (current === expected) return true
    if (!(current instanceof Error)) return false
    current = current.cause
  }
  return false
}

describe('safeRead integration boundaries', () => {
  it('rejects a hostile transport snapshot as INVALID_CONFIG with its original cause', async () => {
    const [base] = createMemoryTransportPair()
    const failure = new Error('send getter failed')
    const transport = new Proxy(base, {
      get(target, key, receiver) {
        if (key === 'send') throw failure
        return Reflect.get(target, key, receiver)
      }
    })
    let received: unknown
    try {
      await createClientEndpoint({
        id: 'hostile-transport',
        transport,
        middlewares: [connect({ transport })]
      })
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({ code: 'INVALID_CONFIG' })
    expect(reachesCause(received, failure)).toBe(true)
  })

  it('keeps plugin construction and schema validation codes above hostile getters', () => {
    const failure = new Error('getter failed')
    let pluginError: unknown
    try {
      assertPluginInstallResult({
        get extension(): never {
          throw failure
        },
        ports: {}
      })
    } catch (error) {
      pluginError = error
    }
    expect(pluginError).toMatchObject({ code: 'INVALID_CONFIG' })
    expect(reachesCause(pluginError, failure)).toBe(true)

    let schemaError: unknown
    try {
      validateContractData(
        {
          get schemas(): never {
            throw failure
          }
        } as IRpcContractConfig,
        'method',
        'params',
        1
      )
    } catch (error) {
      schemaError = error
    }
    expect(schemaError).toMatchObject({ code: 'SCHEMA_INVALID' })
    expect(reachesCause(schemaError, failure)).toBe(true)
  })

  it('keeps parser failure first when reading its issues throws', () => {
    const issueRead = new Error('issues getter failed')
    const primary = {
      get issues(): never {
        throw issueRead
      }
    }
    let failure: unknown
    try {
      validateContractData(
        {
          schemas: {
            method: {
              params: {
                parse() {
                  throw primary
                }
              },
              result: { parse() {} }
            }
          }
        },
        'method',
        'params',
        1
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({ code: 'SCHEMA_INVALID' })
    const cause = (failure as Error).cause
    expect(cause).toBeInstanceOf(AggregateError)
    expect((cause as AggregateError).errors).toEqual([primary, issueRead])
  })

  it('reports a hostile route field once while keeping admission closed', () => {
    const failure = new Error('profile getter failed')
    let reads = 0
    let observed: unknown
    try {
      normalizeRpcEnvelope({
        kind: 'request',
        id: 't',
        method: 'm',
        data: {
          route: {
            get profile(): never {
              reads += 1
              throw failure
            },
            type: 'request',
            applicationVersion: '1',
            senderId: 'sender',
            targetId: 'target',
            sentAt: 1
          }
        }
      })
    } catch (error) {
      observed = error
    }
    expect(observed).toMatchObject({ code: 'INVALID_ENVELOPE', cause: failure })
    expect(reads).toBe(1)
  })

  it('keeps registration failure first when its message getter fails during cleanup', async () => {
    const [transport] = createMemoryTransportPair()
    const kernel = createEndpointKernel(transport)
    const readFailure = new Error('message getter failed')
    const primary = {
      get message(): never {
        throw readFailure
      }
    }
    let received: unknown
    try {
      kernel.activate({
        unsubscribe: () => undefined,
        commit: () => {
          throw primary
        }
      })
    } catch (error) {
      received = error
    }
    expect(received).toBeInstanceOf(RpcConstructionError)
    const cause = (received as RpcConstructionError).cause
    expect(cause).toBeInstanceOf(AggregateError)
    expect((cause as AggregateError).errors[0]).toBe(primary)
    expect((cause as AggregateError).errors[1]).toMatchObject({
      code: 'PROPERTY_READ_FAILED',
      cause: readFailure
    })
    await (received as RpcConstructionError).cleanupPromise
  })

  it('reports hostile graph reads while traversing each reachable identity once', () => {
    const readFailure = new Error('cause getter failed')
    const child = new Error('child')
    const root = {
      get cause(): never {
        throw readFailure
      },
      errors: [child, 7],
      cleanupErrors: [{ error: child }]
    }
    const failures: Array<{ pointer: string; field: string; error: unknown }> = []
    expect([...reachRpcError(root, { report: (failure) => failures.push(failure) })]).toEqual([
      root,
      child,
      7
    ])
    expect(failures).toEqual([{ pointer: '', field: 'cause', error: readFailure }])
  })

  it('reports failed aggregate indexes and cleanup entries without losing the root', () => {
    const indexFailure = new Error('index read failed')
    const cleanupFailure = new Error('cleanup read failed')
    const errors = new Proxy([new Error('hidden')], {
      get(target, key, receiver) {
        if (key === '0') throw indexFailure
        return Reflect.get(target, key, receiver)
      }
    })
    const root = {
      errors,
      cleanupErrors: [
        {
          get error(): never {
            throw cleanupFailure
          }
        }
      ]
    }
    const failures: Array<{ pointer: string; field: string; error: unknown }> = []
    expect([...reachRpcError(root, { report: (failure) => failures.push(failure) })]).toEqual([
      root
    ])
    expect(failures).toEqual([
      { pointer: '', field: '0', error: indexFailure },
      { pointer: '/cleanupErrors/0', field: 'error', error: cleanupFailure }
    ])
  })
})
