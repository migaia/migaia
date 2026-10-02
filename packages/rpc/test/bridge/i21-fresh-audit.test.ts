import { afterEach, expect, it, vi } from 'vitest'
import { bridgeFixture } from './fixture.js'
import { readJsonObjectPort } from '../../src/core/internal/json-object-port.js'
import { rpcProtocolV1 } from '../../src/contract/index.js'
import { createRpcStreamFrameDecoderWithLimit } from '../../src/contract/framing/stream.js'
import { PROCESS_HANDSHAKE_MAX_FRAME_BYTES } from '../../src/process/constants.js'
import { normalizeRemoteHostCatalog, RemoteCatalogLimit } from '../../src/remote/contract.js'
import { createJsonRpcFrameDecoder } from '../../src/bridge/jsonrpc/framing.js'

/** Release global allocation observers after every adversarial case. */
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('[EQ2 audit] rejects counterfeit descriptor identities even when all metadata matches', async () => {
  /** The physical channel supplies the only authoritative paired identities. */
  const fixture = bridgeFixture()
  /** Closing revokes the private registry rather than retaining audit payloads. */
  const channel = await fixture.open()
  try {
    expect(
      readJsonObjectPort(
        channel.transport,
        rpcProtocolV1,
        channel.pipeline.codec,
        channel.pipeline.framer
      )
    ).toBeDefined()
    expect(
      readJsonObjectPort(
        channel.transport,
        { ...rpcProtocolV1 },
        channel.pipeline.codec,
        channel.pipeline.framer
      )
    ).toBeUndefined()
    expect(
      readJsonObjectPort(
        channel.transport,
        rpcProtocolV1,
        { ...channel.pipeline.codec },
        channel.pipeline.framer
      )
    ).toBeUndefined()
    expect(
      readJsonObjectPort(channel.transport, rpcProtocolV1, channel.pipeline.codec, {
        ...channel.pipeline.framer
      })
    ).toBeUndefined()
  } finally {
    await channel.close()
  }
})

it('[EQ5 audit] rejects declared oversized inbound body before allocating any body buffer', () => {
  /** Fixed header bytes belong to the decoder; only subsequent allocations count as body. */
  const decoder = createJsonRpcFrameDecoder()
  /** Construct hostile bytes before installing the production allocation observer. */
  const input = Buffer.from('Content-Length: 16777217\r\n\r\n')
  /** Native semantics remain intact while every protected body allocation is counted. */
  const native = Uint8Array
  /** No allocation is authorized by an invalid length declaration. */
  const allocations: unknown[] = []
  vi.stubGlobal(
    'Uint8Array',
    new Proxy(native, {
      construct(target, argumentsList) {
        allocations.push(argumentsList[0])
        return Reflect.construct(target, argumentsList)
      }
    })
  )
  expect(() => decoder.push(input)).toThrow(
    expect.objectContaining({ code: 'JSONRPC_FRAME_INVALID' })
  )
  expect(allocations).toEqual([])
  decoder.close()
})

it('[EQ5 audit] rejects a native pre-hello length beyond 64 KiB before body allocation', () => {
  /** No complete unauthenticated frame may escape this boundary. */
  const onFrame = vi.fn()
  /** The original error code remains observable without a provider call. */
  const errors: unknown[] = []
  /** The phase-specific limit is the process owner's existing constant. */
  const decoder = createRpcStreamFrameDecoderWithLimit(
    { onFrame, onError: (error) => errors.push(error) },
    () => PROCESS_HANDSHAKE_MAX_FRAME_BYTES
  )
  /** The hostile declaration exists before allocation instrumentation. */
  const input = new Uint8Array(4)
  new DataView(input.buffer).setUint32(0, 65537, false)
  /** The fixed decoder header is already allocated and does not count as payload. */
  const native = Uint8Array
  /** Rejected declared payloads must not obtain any body buffer. */
  const allocations: unknown[] = []
  vi.stubGlobal(
    'Uint8Array',
    new Proxy(native, {
      construct(target, argumentsList) {
        allocations.push(argumentsList[0])
        return Reflect.construct(target, argumentsList)
      }
    })
  )
  expect(PROCESS_HANDSHAKE_MAX_FRAME_BYTES).toBe(65536)
  decoder.push(input)
  expect(errors).toEqual([expect.objectContaining({ code: 'FRAME_LIMIT_EXCEEDED' })])
  expect(allocations).toEqual([])
  expect(onFrame).not.toHaveBeenCalled()
  decoder.close()
})

it.each(['plugins', 'features', 'methods', 'aggregate'] as const)(
  '[EQ5 audit] checks %s catalog capacity before the rejected table getters',
  (kind) => {
    /** A getter in the first forbidden table must remain unobserved. */
    const rejectedRead = vi.fn(() => ({ mode: 'request', idempotent: false }))
    /** Construct declared keys without reading entry values. */
    const table = (count: number, getter: () => unknown): Record<string, unknown> => {
      /** Null records retain the supported declared catalog grammar. */
      const result: Record<string, unknown> = Object.create(null)
      for (let index = 0; index < count; index++)
        Object.defineProperty(result, `m${index}`, { enumerable: true, get: getter })
      return result
    }
    /** Only the explicit aggregate case admits earlier method tables. */
    const ordinaryMethod = () => ({ mode: 'request', idempotent: false })
    /** A valid root lets the selected bound be the first rejection. */
    let catalog: unknown
    /** The semantic limit name is asserted rather than merely observing any thrown error. */
    let limit: string
    if (kind === 'plugins') {
      catalog = table(65, rejectedRead)
      limit = 'pluginsPerCatalog'
    } else if (kind === 'features') {
      catalog = { p: { schemaVersion: 1, plugin: 'p', features: table(65, rejectedRead) } }
      limit = 'featuresPerContract'
    } else if (kind === 'methods') {
      catalog = {
        p: { schemaVersion: 1, plugin: 'p', features: { f: { methods: table(129, rejectedRead) } } }
      }
      limit = 'methodsPerFeature'
    } else {
      /** Thirty-two admitted tables consume exactly 4096 declarations before the forbidden suffix. */
      const features: Record<string, unknown> = {}
      for (let index = 0; index < 32; index++)
        features[`f${index}`] = { methods: table(128, ordinaryMethod) }
      features.f32 = { methods: table(1, rejectedRead) }
      catalog = { p: { schemaVersion: 1, plugin: 'p', features } }
      limit = 'methodsPerCatalog'
    }
    expect(RemoteCatalogLimit).toEqual({
      pluginsPerCatalog: 64,
      featuresPerContract: 64,
      methodsPerFeature: 128,
      methodsPerCatalog: 4096,
      detailPathChars: 256
    })
    expect(() => normalizeRemoteHostCatalog(catalog)).toThrow(
      expect.objectContaining({
        code: 'REMOTE_CONTRACT_INVALID',
        detail: expect.objectContaining({ limit })
      })
    )
    expect(rejectedRead).not.toHaveBeenCalled()
  }
)
