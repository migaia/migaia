import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
import { createRpcSchemaValidationError } from '../../dist/host/error-owner.js'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineFlowFeature } from '@migaia/rpc-host/sdk'
import { RpcWireKind, type IRpcSemanticFrame } from '@migaia/rpc-contract/protocol'
import { validateContractData } from '../../dist/features/schema/validate.js'
import { coreMemoryServer } from '../host/core-fixture.ts'

describe('safeString failure reporting', () => {
  it('preserves the original public provider registration failure', async () => {
    /** The actual descriptor compiler must retain this exact original registration failure. */
    const primary = new Error('registration')
    /** Provider registration owns reflection before any native transport resource is acquired. */
    const provide = new Proxy(
      {},
      {
        ownKeys() {
          throw primary
        }
      }
    )
    /** A genuine cold transport supplies the same public root options without a fake installer. */
    const server = coreMemoryServer('registration-failure')
    /** Only the public entry constructs and classifies the failure received by the application. */
    let received: unknown
    try {
      await createRpcHost({ ...server.options, provide, report: () => undefined })
    } catch (error) {
      received = error
    }
    expect(received).toMatchObject({ code: 'INVALID_CONFIG' })
    expect((received as Error).cause).toBe(primary)
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
    const validation = defineFlowFeature({
      phase: 1000,
      name: 'original-schema-failure',
      setup: () => ({
        stages: {
          dispatchInbound() {
            throw primary
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
      plugins: [rpcFeaturesPlugin({ features: { validation } }), ...server.options.plugins!],
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
