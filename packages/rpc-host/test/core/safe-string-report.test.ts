import { createRpcSchemaValidationError } from '../../dist/host/error-owner.js'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowPlugin, defineTransportPlugin } from '@migaia/rpc-host/sdk'
import { RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { validateContractData } from '../../dist/plugins/schema/validate.js'
import { coreMemoryServer } from '../host/core-fixture.js'

describe('safeString failure reporting', () => {
  it('preserves a registration failure before its conversion failure', async () => {
    const conversion = new Error('string conversion')
    const primary = new Error('registration')
    Object.defineProperty(primary, 'message', {
      value: {
        toString() {
          throw conversion
        }
      }
    })
    /** The actual native installation now owns the original resource-acquisition rejection. */
    const transport = defineTransportPlugin({
      name: 'registration-failure',
      namespace: 'memory',
      open() {
        throw primary
      }
    })
    let received: unknown
    try {
      await createRpcHost({ plugins: [transport], report: () => undefined })
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
    const primary = createRpcSchemaValidationError('schema failed', {}, undefined)
    Object.defineProperty(primary, 'message', {
      value: {
        toString() {
          throw conversion
        }
      }
    })
    /** The fixed dispatch hook is the same validation failure boundary before business execution. */
    const validation = defineFlowPlugin({
      name: 'original-schema-failure',
      setup: () => ({
        hooks: {
          dispatch: {
            inbound() {
              throw primary
            }
          }
        }
      })
    })
    const events: unknown[] = []
    /** The public namespace uses the existing real carrier rather than a private executor facade. */
    const server = coreMemoryServer('host')
    /** Each actual diagnostic retains its original Error reference and native semantic code. */
    const host = await createRpcHost({
      ...server.options,
      provide: { test: () => null },
      plugins: [validation, ...server.options.plugins!],
      report: (error) => events.push({ error, code: Reflect.get(error as object, 'code') })
    })
    /** The accepted pair lends its original write only to inspect the actual flat terminal code. */
    const client = await server.connect('peer')
    /** One explicit operation keeps native write and event capture below the closure limit. */
    const operation = { write: client.pair[0].write, events }
    /** Fixed new-protocol metadata replaces only the deleted response envelope's structural path. */
    const writing = vi.spyOn(client.pair[0], 'write').mockImplementation((frame, options) => {
      /** This existing reference carrier encodes its admitted semantic value directly in data. */
      const message = frame.data as IRpcSemanticFrame
      if (message.kind === RpcWireKind.error) {
        /** The actual admitted graph carries the original semantic response code. */
        operation.events.push({
          response: { code: message.error.nodes[message.error.root]!.code }
        })
      }
      return operation.write(frame, options)
    })
    try {
      await client.host.memory.send('host', 'test', null).catch(() => undefined)
      expect(events[0]).toEqual({ error: conversion, code: 'SCHEMA_INVALID' })
      expect(
        events.some(
          (event) =>
            'response' in (event as object) &&
            (event as { response?: { code?: string } }).response?.code === 'SCHEMA_INVALID'
        )
      ).toBe(true)
    } finally {
      writing.mockRestore()
      await client.host.close()
      await host.close()
    }
  })
})
