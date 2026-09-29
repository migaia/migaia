import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { createClientEndpoint } from '../../src/core/client.js'
import { connect } from '../../src/core/middleware/connect.js'
import { assertPluginInstallResult } from '../../src/core/internal/plugin-descriptor.js'
import { validateContractData } from '../../src/core/internal/contract.js'
import { normalizeWebRpcRoutingData } from '../../src/core/internal/routing-data.js'
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
    const observed: Array<{ key: PropertyKey; error: unknown }> = []
    const route = normalizeWebRpcRoutingData(
      {
        webRpc: {
          get profile(): never {
            throw failure
          },
          type: 'request',
          applicationVersion: '1',
          senderId: 'sender',
          targetId: 'target',
          sentAt: 1
        }
      },
      (item) => {
        observed.push(item)
        return undefined
      }
    )
    expect(route).toBeUndefined()
    expect(observed).toEqual([{ key: 'profile', error: failure }])
  })
})
