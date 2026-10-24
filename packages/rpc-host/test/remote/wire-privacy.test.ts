import { createRuntimeEndpointComposition } from '../../dist/core/runtime-api-endpoint.js'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createMemoryTransportPair } from '../fixtures/memory-transport.js'

import { createComposedEndpoint } from '../../dist/core/composed.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { hooks } from '../../dist/core/middleware/hooks.js'
import { serializeRpcError } from '../../dist/core/internal/error-wire-metadata.js'
import { normalizeRpcEnvelope, RpcContractErrorCode } from '@migaia/rpc-contract'
import { normalizeRemoteHostCatalog } from '../../dist/remote/contract.js'
import { streamRoots } from '../streaming/fixture.js'
import { RpcRemoteLayerErrorCode } from '../../dist/remote/error-code.js'

/** An actual protocol read violation retains the supplied local getter failure without a factory. */
function contractReadFailure(original: Error): Error {
  /** Capture only the genuine error thrown by Contract's public envelope operation. */
  let failure: Error | undefined
  try {
    normalizeRpcEnvelope({
      get kind() {
        throw original
      }
    })
  } catch (error) {
    failure = error as Error
  }
  expect(failure).toBeInstanceOf(TypeError)
  return failure!
}

/** Keeps hostile-input failures observable locally without disclosing their causes remotely. */
describe('local contract error privacy', () => {
  it.each(['remote', 'contract'] as const)(
    'preserves %s original cause locally and sends only code/message',
    async (kind) => {
      /** A fresh marker detects accidental disclosure through causes, data, messages or stacks. */
      const marker = randomUUID()
      /** This original error represents a local hostile catalog getter failure. */
      const original = new Error(marker)
      /** Construct the same error a Host descriptor admission produces before publication. */
      /** Keep the exact factory-created local wrapper available for identity assertions. */
      let local: Error
      if (kind === 'remote') {
        try {
          normalizeRemoteHostCatalog({
            get p() {
              throw original
            }
          })
        } catch (error) {
          local = error as Error
        }
      } else local = contractReadFailure(original)
      expect(local!.cause).toBe(original)
      /** Both the public serializer and stream error frames retain their required top-level shape. */
      const serialized = serializeRpcError(local!, { report: vi.fn() })
      expect(Object.keys(serialized).sort()).toEqual(['code', 'message', 'name', 'source', 'stack'])
      expect(JSON.stringify(serialized)).not.toContain(marker)
      expect((local! as Error).cause).toBe(original)
      /** Production memory endpoints exercise the same provider response path as process Host. */
      const [clientTransport, serverTransport] = createMemoryTransportPair()
      /** Report retains the exact local failure for diagnosis rather than copying its text. */
      const reports: unknown[] = []
      /** The production provider/stream owner emits the controlled failure. */
      const server = await createRuntimeEndpointComposition(
        {
          id: 'privacy-server',
          transport: serverTransport,
          middlewares: [
            connect({ transport: serverTransport }),
            hooks({
              listeners: (event) => {
                if (event.name === 'failure') reports.push(event)
              }
            })
          ],
          provider: {
            describe: () => {
              throw local!
            }
          }
        },
        { agreement: { capabilities: [] }, peerId: '' }
      ).installing
      /** Responses are observed after real codec/route processing, independent of client exceptions. */
      /** Only received production frames are inspected for the original marker. */
      const frames: unknown[] = []
      /** Observe real inbound wire frames until resource cleanup. */
      const unsubscribe = clientTransport.subscribe(({ data }) => frames.push(data))
      /** The production requester decodes the response through the public owner. */
      const client = await createRuntimeEndpointComposition(
        {
          id: 'privacy-client',
          transport: clientTransport,
          targetIds: ['privacy-server'],
          middlewares: [connect({ transport: clientTransport })]
        },
        { agreement: { capabilities: [] }, peerId: '' }
      ).installing
      try {
        /** Each locally controlled factory owns its distinct semantic rejection code. */
        const code =
          kind === 'remote'
            ? RpcRemoteLayerErrorCode.contractInvalid
            : RpcContractErrorCode.invalidEnvelope
        await expect(
          client.send('privacy-server', 'describe', null, { timeoutMs: 1000 })
        ).rejects.toMatchObject({ code, message: local!.message })
        expect(frames).toHaveLength(1)
        expect(frames[0]).toMatchObject({
          kind: 'response',
          ok: false,
          code,
          message: local!.message
        })
        expect(frames[0]).not.toHaveProperty('serializedError')
        expect(JSON.stringify(frames)).not.toContain(marker)
        expect(JSON.stringify(frames)).not.toContain(original.message)
        expect(reports).toHaveLength(1)
        expect(reports[0]).toMatchObject({ error: local! })
        expect(local!.cause).toBe(original)
      } finally {
        unsubscribe()
        await client.dispose()
        await server.dispose()
      }
    }
  )

  it('keeps the original cause local when a real stream emits a controlled failure', async () => {
    /** The original arbitrary getter message must not enter any real stream frame. */
    const original = new Error(randomUUID())
    /** The contract owner preserves this original cause on its local wrapper. */
    const local = contractReadFailure(original)
    const [clientTransport, serverTransport] = createMemoryTransportPair()
    /** The production provider/stream owner emits the controlled failure. */
    const server = await createComposedEndpoint(
      {
        id: 'stream-privacy-server',
        transport: serverTransport,
        middlewares: [connect({ transport: serverTransport })]
      },
      streamRoots()
    )
    /** The production requester decodes the response through the public owner. */
    const client = await createComposedEndpoint(
      {
        id: 'stream-privacy-client',
        transport: clientTransport,
        middlewares: [connect({ transport: clientTransport })]
      },
      streamRoots()
    )
    /** Only received production frames are inspected for the original marker. */
    const frames: unknown[] = []
    /** Observe real inbound wire frames until resource cleanup. */
    const unsubscribe = clientTransport.subscribe(({ data }) => frames.push(data))
    /** The stream provider owns its registration until final cleanup. */
    const release = server.stream.provide('controlled-failure', async function* () {
      throw local
    })
    /** The real stream has an explicit one-second call deadline. */
    const iterator = client.stream.open('stream-privacy-server', 'controlled-failure', [], {
      timeoutMs: 1000
    })
    try {
      /** Capture the decoded stream error without losing its original assertion surface. */
      const failure = await iterator.next().catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: RpcContractErrorCode.invalidEnvelope,
        message: local.message
      })
      expect((failure as Error).cause).toBeUndefined()
      expect(JSON.stringify(frames)).not.toContain(original.message)
      expect(local.cause).toBe(original)
    } finally {
      unsubscribe()
      release()
      await client.dispose()
      await server.dispose()
    }
  })

  it('preserves complete business error descendants and ignores forged contract identities', () => {
    /** Ordinary application failures retain the existing wire-error cause contract. */
    const original = new Error('business cause fixture')
    /** Ordinary business wrappers continue exposing their complete cause graph. */
    const business = new Error('business wrapper fixture', { cause: original })
    /** Source/code properties alone cannot authorize the local disclosure policy. */
    const forged = Object.assign(business, {
      source: 'rpc.remote',
      code: 'REMOTE_CONTRACT_INVALID'
    })
    expect(serializeRpcError(forged, { report: vi.fn() })).toMatchObject({
      cause: { message: original.message }
    })
    expect(business.cause).toBe(original)
  })
})
