/** Original privacy atoms use current canonical error admission and real public request/stream IO. */
import { randomUUID } from 'node:crypto'
import { assert, describe, expect, it, vi } from 'vitest'
import type { IRpcHost } from '@migaia/rpc-host'
import { normalizePortable } from '@migaia/rpc-contract/portable'
import type { IRpcProviderDeclaration } from '@migaia/rpc-contract/protocol'
import { RpcContractErrorCode, RpcRemoteLayerErrorCode } from '@migaia/rpc-contract/error-code'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { errorMap } from '@migaia/rpc-host/plugins/error-map'
import { deserializeRpcError } from '@migaia/rpc-contract/errors'
import { hostErrorWireMetadata, serializeRpcError } from '../../dist/host/error-wire-metadata.js'
import { connectedCoreHosts } from '../host/core-fixture.js'

/**
 * The wire snapshot reads hostile getters and retains the native Contract type/code and local
 * cause.
 */
function contractReadFailure(original: Error): Error {
  /** Failure is captured from the real validator, never constructed from public code properties. */
  let failure: unknown
  try {
    normalizePortable(
      {
        get value() {
          throw original
        }
      },
      0,
      undefined,
      false,
      hostErrorWireMetadata
    )
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TypeError)
  assert(failure instanceof Error)
  return failure
}

/** The real Host provider-declaration owner replaces the removed remote Host catalog DTO boundary. */
function declarationReadFailure(server: Pick<IRpcHost, 'provide'>, original: Error): Error {
  /** Only a current advanced declaration getter supplies the controlled local failure. */
  const declaration: IRpcProviderDeclaration = {
    schemaVersion: 1,
    plugin: 'privacy',
    get features(): IRpcProviderDeclaration['features'] {
      throw original
    }
  }
  /** Native error identity and summary provenance come only from actual Host admission. */
  let failure: unknown
  try {
    server.provide({ privacy: { f: { value: () => null } } }, { contract: declaration })
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TypeError)
  assert(failure instanceof Error)
  return failure
}

/** Select the existing controlled presentation explicitly without changing its local Error graph. */
function redactControlledError(error: unknown): Error {
  return deserializeRpcError(
    serializeRpcError(error, {
      report: (failure) => {
        throw failure.error
      }
    })
  )
}

describe('application-selected contract error privacy through public native Hosts', () => {
  it.each(['remote', 'contract'] as const)(
    'preserves %s original cause locally and explicitly sends only code/message',
    async (kind) => {
      /** The fresh original marker detects disclosure in any error field, frame or descendant. */
      const marker = randomUUID()
      /** The original hostile getter failure remains available for exact-reference diagnosis. */
      const original = new Error(marker)
      /** Both error construction and the real provider retain this same canonical local object. */
      let local: Error
      /** Reports receive the original failure object rather than a replacement diagnostic DTO. */
      const reports: unknown[] = []
      /** Existing actual carriers/codec/Session owners deliver the genuine request and response. */
      const fixture = await connectedCoreHosts(
        {},
        {
          describe: () => {
            throw local
          }
        },
        () => undefined,
        undefined,
        (error) => reports.push(error),
        [errorMap(redactControlledError)]
      )
      try {
        local =
          kind === 'remote'
            ? declarationReadFailure(fixture.b, original)
            : contractReadFailure(original)
        expect(local.cause).toBe(original)
        /** The maintained legacy serializer still exposes only its fixed five-field safe summary. */
        const serialized = serializeRpcError(local, { report: vi.fn() })
        // The controlled summary's five own fields are a compile-time fixed serializer contract.
        expect(Object.keys(serialized).sort()).toEqual([
          'code',
          'message',
          'name',
          'source',
          'stack'
        ])
        expect(JSON.stringify(serialized)).not.toContain(marker)
        expect(local.cause).toBe(original)
        /**
         * Snapshot only the business interval after real handshake/directory construction is
         * complete.
         */
        const start = fixture.pair[1].written.length
        /** Each genuine canonical error retains the same original public semantic code. */
        const code =
          kind === 'remote'
            ? RpcRemoteLayerErrorCode.contractInvalid
            : RpcContractErrorCode.invalidEnvelope
        await expect(
          fixture.a.memory.send('b', 'describe', null, { timeout: timeout({ ms: 1000 }) })
        ).rejects.toMatchObject({ code, message: local.message })
        /**
         * The identity medium records original post-codec frames without decoding or restoring
         * again.
         */
        const frames = fixture.pair[1].written.slice(start)
        expect(frames).toHaveLength(1)
        /**
         * BC2's actual error frame replaces the old response/ok:false DTO, preserving the error
         * atom.
         */
        const frame = frames[0]
        expect(frame).toMatchObject({ kind: 'error', task: { method: 'describe' } })
        assert(frame?.kind === 'error')
        expect(frame.error.nodes[frame.error.root]).toMatchObject({ code, message: local.message })
        expect(frame.error.nodes).toHaveLength(1)
        expect(frame.error.nodes[frame.error.root]).not.toHaveProperty('cause')
        expect(frame).not.toHaveProperty('serializedError')
        expect(JSON.stringify(frames)).not.toContain(marker)
        expect(JSON.stringify(frames)).not.toContain(original.message)
        expect(reports).toHaveLength(1)
        expect(reports[0]).toBe(local)
        expect(local.cause).toBe(original)
      } finally {
        await fixture.close()
      }
    }
  )

  it('keeps the original cause local with explicit redaction of a real controlled stream failure', async () => {
    /**
     * The original arbitrary getter marker must not enter any actual stream terminal or other
     * frame.
     */
    const original = new Error(randomUUID())
    /** Canonical Contract admission owns this exact local wrapper and its private summary. */
    const local = contractReadFailure(original)
    /**
     * The genuine provider executes its original asynchronous generator under the sole stream
     * owner.
     */
    const fixture = await connectedCoreHosts(
      {},
      {
        'controlled-failure': async function* () {
          throw local
        }
      },
      () => undefined,
      undefined,
      undefined,
      [errorMap(redactControlledError)]
    )
    try {
      /**
       * Native post-handshake writes provide the actual wire observation, without a parallel
       * emitter.
       */
      const start = fixture.pair[1].written.length
      /** The original one-second deadline is a complete timeout feature on the real directed stream. */
      const iterator = fixture.a.memory.streamTo('b', 'controlled-failure', [], {
        timeout: timeout({ ms: 1000 })
      })
      /** Keep the genuine consumer's failure rather than decoding its terminal in a fixture path. */
      const failure = await iterator.next().catch((error: unknown) => error)
      expect(failure).toMatchObject({
        code: RpcContractErrorCode.invalidEnvelope,
        message: local.message
      })
      expect((failure as Error).cause).toBeUndefined()
      /**
       * Only the actual received terminal may prove that the secret stayed outside stream wire
       * data.
       */
      const frames = fixture.pair[1].written.slice(start)
      expect(frames.some((frame) => frame.kind === 'stream' && frame.stream.event === 'fail')).toBe(
        true
      )
      expect(JSON.stringify(frames)).not.toContain(original.message)
      expect(local.cause).toBe(original)
    } finally {
      await fixture.close()
    }
  })

  it('preserves complete business error descendants and ignores forged contract identities', async () => {
    /** Ordinary application failures retain their complete original graph in the legacy serializer. */
    const original = new Error('business cause fixture')
    /** The original wrapper must remain locally reachable while its graph crosses the real wire. */
    const business = new Error('business wrapper fixture', { cause: original })
    /** Public source/code properties do not register a trusted privacy summary for this object. */
    const forged = Object.assign(business, {
      source: 'rpc.remote',
      code: 'REMOTE_CONTRACT_INVALID'
    })
    expect(serializeRpcError(forged, { report: vi.fn() })).toMatchObject({
      cause: { message: original.message }
    })
    expect(business.cause).toBe(original)
    /**
     * A genuine provider throws the unchanged forged value; no code-based fixture translation
     * occurs.
     */
    const fixture = await connectedCoreHosts(
      {},
      {
        forged: () => {
          throw forged
        }
      },
      () => undefined
    )
    try {
      /** Real error frames remain passively inspectable on this already-established identity medium. */
      const start = fixture.pair[1].written.length
      /** The actual consumer reconstructs the new wire graph through its canonical codec/restore. */
      const failure = await fixture.a.memory
        .send('b', 'forged', null)
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ cause: { message: original.message, stack: original.stack } })
      /** The received flat graph has a real cause edge, despite the forged controlled-looking code. */
      const frame = fixture.pair[1].written.slice(start).find((value) => value.kind === 'error')
      assert(frame?.kind === 'error')
      /** The root is the same business error projection, not a trusted replacement summary. */
      const root = frame.error.nodes[frame.error.root]!
      expect(root).toMatchObject({
        source: 'rpc.remote',
        code: 'REMOTE_CONTRACT_INVALID',
        message: business.message,
        stack: business.stack
      })
      expect(root.cause).toEqual(expect.any(Number))
      expect(frame.error.nodes[root.cause!]).toMatchObject({
        name: original.name,
        message: original.message,
        stack: original.stack
      })
      expect(business.cause).toBe(original)
    } finally {
      await fixture.close()
    }
  })
})
