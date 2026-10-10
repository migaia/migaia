import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { safeString } from '../../src/core/transport-kit.js'
import { createNodeMessagePortTransport } from '../../src/core/adapters/message-port.js'
import { createEndpointKernel } from '../../src/core/endpoint-kernel.js'
import { validateContractData } from '../../src/core/internal/contract.js'
import { RpcRouteProfile, normalizeRpcEnvelope } from '../../src/contract/index.js'
import { RpcSchemaValidationError } from '../../src/core/errors.js'
import { ProviderExecutor } from '../../src/core/internal/provider-executor.js'
import { ProviderRegistry } from '../../src/core/internal/provider.js'
import { ProviderAdmissionRegistry } from '../../src/core/internal/provider-admission.js'

describe('[A11] safeString failure reporting', () => {
  it('passes strings through and converts a normal object once', () => {
    let conversions = 0
    expect(safeString('ready')).toBe('ready')
    expect(
      safeString({
        toString() {
          conversions += 1
          return 'converted'
        }
      })
    ).toBe('converted')
    expect(conversions).toBe(1)
  })
  it('keeps one conversion and reports the original failure once', () => {
    const original = new Error('conversion failed')
    const failures: unknown[] = []
    let conversions = 0
    const value = {
      toString() {
        conversions += 1
        throw original
      }
    }
    expect(
      safeString(value, 'fallback', ({ error }) => {
        failures.push(error)
        return undefined
      })
    ).toBe('fallback')
    expect(conversions).toBe(1)
    expect(failures).toEqual([original])
  })

  it('throws a coded native TypeError without a reporter', () => {
    const original = new Error('conversion failed')
    const value = {
      [Symbol.toPrimitive]() {
        throw original
      }
    }
    try {
      safeString(value)
      throw new Error('safeString should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError)
      expect(error).toMatchObject({
        source: '@migaia/rpc/core',
        code: 'STRING_CONVERSION_FAILED',
        message: 'rpc string conversion failed',
        cause: original
      })
      expect((error as Error).stack).toBeTruthy()
    }
  })

  it('keeps conversion and reporter failures in their original order', () => {
    const original = new Error('conversion failed')
    const reporterFailure = new Error('report failed')
    let reportCalls = 0
    try {
      safeString(
        {
          toString: () => {
            throw original
          }
        },
        'fallback',
        () => {
          reportCalls += 1
          throw reporterFailure
        }
      )
      throw new Error('safeString should have thrown')
    } catch (error) {
      expect(error).toMatchObject({ code: 'STRING_CONVERSION_FAILED' })
      const cause = (error as Error).cause
      expect(cause).toBeInstanceOf(AggregateError)
      expect((cause as AggregateError).errors).toEqual([original, reporterFailure])
    }
    expect(reportCalls).toBe(1)
  })

  it('keeps a Proxy primitive trap and rejects asynchronous reporters at typecheck', () => {
    const failure = new Error('primitive getter')
    const value = new Proxy(
      {},
      {
        get(_target, key) {
          if (key === Symbol.toPrimitive) throw failure
          return undefined
        }
      }
    )
    const failures: unknown[] = []
    expect(
      safeString(value, 'fallback', ({ error }) => {
        failures.push(error)
        return undefined
      })
    ).toBe('fallback')
    expect(failures).toEqual([failure])
    const typecheckOnly = (): void => {
      // @ts-expect-error The reporter must finish synchronously.
      safeString(value, 'fallback', async () => undefined)
    }
    void typecheckOnly
  })

  it('preserves a registration failure before its conversion failure', () => {
    const conversion = new Error('string conversion')
    const primary = new Error('registration')
    Object.defineProperty(primary, 'message', {
      value: {
        toString() {
          throw conversion
        }
      }
    })
    const kernel = createEndpointKernel({
      platform: 'Memory',
      send() {},
      subscribe: () => () => undefined
    })
    let received: unknown
    try {
      kernel.activate({
        unsubscribe() {},
        commit() {
          throw primary
        }
      })
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({ code: 'INVALID_CONFIG' })
    const cause = (received as Error).cause as AggregateError
    expect(cause.errors).toEqual([primary, conversion])
  })

  it('keeps schema parser and conversion failures in order', () => {
    const conversion = new Error('schema conversion')
    const primary = new Error('parser')
    Object.defineProperty(primary, 'message', {
      value: {
        toString() {
          throw conversion
        }
      }
    })
    let received: unknown
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
              result: {
                parse(value) {
                  return value
                }
              }
            }
          }
        },
        'method',
        'params',
        null
      )
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({ code: 'SCHEMA_INVALID' })
    expect(((received as Error).cause as AggregateError).errors).toEqual([primary, conversion])
  })

  it('reports provider schema conversion before sending the fallback response', async () => {
    const conversion = new Error('provider conversion')
    const primary = new RpcSchemaValidationError('schema failed', {}, undefined)
    Object.defineProperty(primary, 'message', {
      value: {
        toString() {
          throw conversion
        }
      }
    })
    const envelope = normalizeRpcEnvelope({
      kind: 'request',
      id: 'task',
      method: 'test',
      data: {
        route: {
          profile: RpcRouteProfile,
          type: 'request',
          applicationVersion: '1.0',
          senderId: 'peer',
          targetId: 'host',
          sentAt: 1
        },
        payload: null
      }
    })
    expect(envelope.kind).toBe('request')
    if (envelope.kind !== 'request') return
    const events: unknown[] = []
    const executor = new ProviderExecutor<string>({
      id: 'host',
      timestamp: () => 1,
      now: () => 1,
      setTimeout: () => ({ clear() {} }),
      clearTimeout: (timer) => timer.clear(),
      registry: new ProviderRegistry(),
      controllers: new Map(),
      admission: new ProviderAdmissionRegistry(),
      peers: [],
      dispatch() {},
      send: async (response) => {
        events.push({ response })
      },
      validate() {
        throw primary
      },
      emitFailure(error, code) {
        events.push({ error, code })
      }
    })
    await executor.execute({ envelope, route: envelope.data })
    expect(events[0]).toEqual({ error: conversion, code: 'SCHEMA_INVALID' })
    expect(
      events.some(
        (event) =>
          'response' in (event as object) &&
          (event as { response?: { code?: string } }).response?.code === 'SCHEMA_INVALID'
      )
    ).toBe(true)
  })

  it('reports a MessagePort conversion failure before deserialization failure', () => {
    const listeners = new Map<string, (value?: unknown) => void>()
    const port = {
      postMessage() {},
      on(event: 'message' | 'messageerror' | 'close', listener: (value?: unknown) => void) {
        listeners.set(event, listener)
      },
      off(event: 'message' | 'messageerror' | 'close') {
        listeners.delete(event)
      }
    }
    const transport = createNodeMessagePortTransport(port)
    const failures: unknown[] = []
    transport.onTransportError?.((error) => failures.push(error))
    const conversion = new Error('port conversion')
    listeners.get('messageerror')?.({
      toString() {
        throw conversion
      }
    })
    expect(failures).toHaveLength(2)
    expect(failures[0]).toMatchObject({ code: 'TRANSPORT', cause: conversion })
    expect(failures[1]).toMatchObject({ code: 'TRANSPORT' })
  })

  it('keeps all seven call sites wired to synchronous reporters', () => {
    const root = resolve(import.meta.dirname, '../../src')
    const files = [
      'core/endpoint-kernel.ts',
      'core/internal/provider-executor.ts',
      'core/internal/contract.ts',
      'core/adapters/message-port.ts',
      'browser/adapters/web-worker.ts'
    ]
    let calls = 0
    for (const path of files) {
      const source = ts.createSourceFile(
        path,
        readFileSync(resolve(root, path), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      )
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isIdentifier(node.expression) &&
          node.expression.text === 'safeString'
        ) {
          calls += 1
          expect(node.arguments, path).toHaveLength(3)
        }
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
    expect(calls).toBe(7)
  })
})
