import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { MessageChannel } from 'node:worker_threads'
import { it, vi } from 'vitest'
import { authentication } from '../../src/core/middleware/authentication.js'
import {
  createRpcIdempotencyStore,
  type IRpcIdempotencyStore
} from '../../src/core/idempotency-store.js'
import { createNodeMessagePortTransport } from '../../src/core/adapters/message-port.js'
import { registerBatchAgreement } from '../../src/core/internal/batch-frame.js'
import {
  createRuntimePeer,
  type IRuntimePeer,
  type IRuntimePeerOptions
} from '../../src/remote/runtime-api/peer.js'
import { createProcessPeer } from '../../src/process/index.js'
import type { IRuntimeDynamicSurface } from '../../src/remote/runtime-api/typing.js'
import { RUNTIME_API_CAPABILITIES } from '../../src/remote/runtime-api/constants.js'
import { runtimeSources } from './fixture.js'
import {
  RpcNativeBinaryKind,
  RpcBinaryProfile
} from '../../src/contract/runtime-api/binary-constants.js'
import { readAuthenticationEnvelope } from '../../src/core/middleware/authentication-envelope.js'
import * as authenticationReplay from '../../src/core/internal/authentication-replay.js'
import { RpcCoreErrorCode } from '../../src/core/errors.js'
import { createRuntimeApiEndpoint } from '../../src/core/internal/runtime-api-endpoint.js'
import {
  codec,
  framer,
  connect,
  abort,
  timeout,
  hooks,
  type IRpcEndpoint
} from '../../src/core/index.js'

/** Both source offers request the exact native profile; no platform label grants this capability. */
const capabilities = [
  ...new Set([
    ...RUNTIME_API_CAPABILITIES,
    'portable-binary@1',
    'native-binary-authenticated-manifest@1',
    'transfer@1'
  ])
]

/** Use actual native ports and canonical owners for all binary acceptance cases in this file. */
async function nativePair(
  beforeSign?: (index: number, value: unknown) => void | Promise<void>,
  parentFactory?: (options: IRuntimePeerOptions) => Promise<IRuntimePeer>,
  offers: readonly [readonly string[], readonly string[]] = [capabilities, capabilities],
  stores?: readonly IRpcIdempotencyStore[],
  authMode: 'sign-only' | 'none' | 'encrypt-presence' = 'sign-only'
) {
  /** The original fixture joins the two independent offers; only its source metadata is reused. */
  const agreement = runtimeSources(offers[0], offers[1])
  /** Real postMessage is the sole structured clone/ownership boundary. */
  const ports = new MessageChannel()
  const transports = [
    createNodeMessagePortTransport(ports.port1),
    createNodeMessagePortTransport(ports.port2)
  ]
  /** Fixed test-only key is never product configuration or included in diagnostics. */
  const signature = (value: unknown) =>
    createHmac('sha256', 'binary-fixture-key').update(JSON.stringify(value)).digest('hex')
  /** Original authentication wraps/signs the manifest once and verifies its actual protected bytes. */
  const auth = (index: number) =>
    authentication({
      encodedType: 'any',
      /** Presence alone excludes native mapping, even if a caller transform returns its input. */
      ...(authMode === 'encrypt-presence'
        ? { encrypt: (value: unknown) => value, decrypt: (value: unknown) => value }
        : {}),
      sign: async (value) => {
        await beforeSign?.(index, value)
        return { body: value, signature: signature(value) }
      },
      verify: async (value) => {
        const signed = value as { body: unknown; signature: string }
        assert.equal(signed.signature, signature(signed.body))
        return signed.body
      }
    })
  /** Provider observations come from the actual canonical receiver, not sender metadata. */
  const received: unknown[] = []
  const reports: unknown[] = []
  const peers = await Promise.all(
    [0, 1].map(async (index) =>
      (index === 0 && parentFactory ? parentFactory : createRuntimePeer)({
        self: {
          name: index === 0 ? 'parent' : 'child',
          instanceId: index === 0 ? 'parent-1' : 'child-1'
        },
        provide:
          index === 0
            ? {}
            : {
                echo: (value: unknown) => {
                  received.push(value)
                  return value
                },
                /** Native stream input uses the same real receiver and canonical credit owner. */
                values: async function* (value: unknown) {
                  received.push(value)
                  yield value
                }
              },
        connect: async (context) => {
          const source = await agreement.sources[index as 0 | 1](context)
          registerBatchAgreement(transports[index]!, source.agreement.capabilities)
          return { ...source, transport: transports[index]! }
        },
        endpointFactory: async (channel) => {
          /** Original native assembly installs the real auth middleware, not a Feature lookalike. */
          const endpoint = await createRuntimeApiEndpoint(
            {
              id: index === 0 ? 'parent-1' : 'child-1',
              scheduler: channel.scheduler,
              transport: channel.transport,
              targetIds: [channel.peerId],
              ...(stores ? { idempotency: { store: stores[index] } } : {}),
              middlewares: [
                codec(channel.pipeline.codec),
                framer(channel.pipeline.framer),
                connect({ transport: channel.transport }),
                abort(),
                timeout(),
                hooks({ onHookError: (error) => reports.push(error) }),
                ...(authMode === 'none' ? [] : [auth(index)])
              ]
            },
            { supports: () => channel.agreement.capabilities.includes('stream@1') },
            true
          )
          return {
            endpoint: endpoint as unknown as IRpcEndpoint,
            oneWay: endpoint,
            stream: endpoint.stream
          }
        },
        report: (error) => reports.push(error)
      })
    )
  )
  return {
    peers,
    ports,
    transports,
    received,
    reports,
    signature,
    close: async () => {
      await Promise.all(peers.map((peer) => peer.close()))
      agreement.close()
      ports.port1.close()
      ports.port2.close()
    }
  }
}

it('[A86] real sign-only MessagePort transfer detaches all sender views and restores the complete receiver backing', async () => {
  /** The same genuine native fixture retains independent physical/provider observations. */
  const fixture = await nativePair()
  const { peers, received, reports } = fixture
  /** Shared views make ownership loss observable independently of Promise completion. */
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  const first = new Uint8Array(backing, 1, 2)
  const second = new Uint8Array(backing, 2, 1)
  try {
    const result = await peers[0]!
      .request('echo', { buffer: backing, first, second }, { transfer: [backing] } as object)
      .catch((error: unknown) => error)
    assert.equal(
      backing.byteLength,
      0,
      '[A86] actual native commit must detach the original complete backing'
    )
    assert.equal(first.byteLength, 0)
    assert.equal(second.byteLength, 0)
    assert.equal(received.length, 1)
    const value = received[0] as { buffer: ArrayBuffer; first: Uint8Array; second: Uint8Array }
    assert.ok(value.buffer instanceof ArrayBuffer)
    assert.equal(value.first.buffer, value.second.buffer)
    assert.equal(value.first.buffer, value.buffer)
    assert.deepEqual([...new Uint8Array(value.buffer)], [9, 1, 2, 8])
    assert.equal(value.first.byteOffset, 1)
    assert.ok(result && typeof result === 'object' && !(result instanceof Error))
    assert.deepEqual(reports, [])
  } finally {
    await fixture.close()
  }
})

it.each(['portable-binary@1', 'native-binary-authenticated-manifest@1', 'transfer@1'])(
  '[A87] native transfer requires bilateral %s and leaves original ownership intact when absent',
  async (missing) => {
    /** Only one actual source removes the selected capability; the other still declares support. */
    const fixture = await nativePair(undefined, undefined, [
      capabilities,
      capabilities.filter((value) => value !== missing)
    ])
    const send = vi.spyOn(fixture.transports[0]!, 'send')
    const backing = new Uint8Array([1]).buffer
    try {
      const result = await Promise.resolve()
        .then(() => fixture.peers[0]!.request('echo', backing, { transfer: [backing] }))
        .catch((error: unknown) => error)
      assert.equal((result as { code?: string })?.code, RpcCoreErrorCode.capabilityUnsupported)
      assert.equal(send.mock.calls.length, 0)
      assert.equal(backing.byteLength, 1)
      assert.equal(fixture.received.length, 0)
    } finally {
      send.mockRestore()
      await fixture.close()
    }
  }
)

it.each([
  'duplicate',
  'unrelated',
  'shared',
  'typedarray',
  'pre-abort',
  'whole-backing-limit'
] as const)(
  '[A87] %s rejects before native commit without losing original backing ownership',
  async (invalid) => {
    const fixture = await nativePair()
    const send = vi.spyOn(fixture.transports[0]!, 'send')
    const backing = new Uint8Array([1, 2]).buffer
    const oversized =
      invalid === 'whole-backing-limit' ? new ArrayBuffer(16 * 1024 * 1024 + 1) : undefined
    const transfer =
      invalid === 'duplicate'
        ? [backing, backing]
        : invalid === 'unrelated'
          ? [new ArrayBuffer(1)]
          : invalid === 'shared'
            ? [new SharedArrayBuffer(1)]
            : invalid === 'typedarray'
              ? [new Uint8Array(backing)]
              : [oversized ?? backing]
    const cancel = new AbortController()
    if (invalid === 'pre-abort') cancel.abort(new Error())
    try {
      const result = await Promise.resolve()
        .then(() =>
          fixture.peers[0]!.request('echo', oversized ? new Uint8Array(oversized, 0, 1) : backing, {
            transfer,
            signal: cancel.signal
          } as object)
        )
        .catch((error: unknown) => error)
      assert.equal(
        (result as { code?: string })?.code,
        invalid === 'pre-abort' ? RpcCoreErrorCode.cancelled : RpcCoreErrorCode.payloadInvalid
      )
      assert.equal(send.mock.calls.length, 0)
      assert.equal(backing.byteLength, 2)
      if (oversized) assert.equal(oversized.byteLength, 16 * 1024 * 1024 + 1)
      assert.equal(fixture.received.length, 0)
    } finally {
      send.mockRestore()
      await fixture.close()
    }
  }
)

it('[A86] lazy native stream transfers its input on first next through the original sender', async () => {
  const fixture = await nativePair()
  const backing = new Uint8Array([1, 2]).buffer
  const stream = fixture.peers[0]!.stream('values', backing, { transfer: [backing] })
  try {
    assert.equal(
      backing.byteLength,
      2,
      '[A86] constructing the canonical lazy iterator performs no native commit'
    )
    const item = await stream.next()
    assert.equal(
      backing.byteLength,
      0,
      '[A86] first-next must retain the original explicit transfer input'
    )
    assert.ok(item.value instanceof ArrayBuffer)
    assert.deepEqual([...new Uint8Array(item.value)], [1, 2])
    await stream.return!(undefined)
    assert.equal(fixture.received.length, 1)
  } finally {
    await stream.return!(undefined)
    await fixture.close()
  }
})

it.each(['request', 'notify', 'stream', 'group'] as const)(
  '[A87] process %s rejects every own transfer field before native send or detach',
  async (mode) => {
    /**
     * The actual process public factory must enforce its family contract even on a capable test
     * carrier.
     */
    const fixture = await nativePair(
      undefined,
      (options) => createProcessPeer<IRuntimeDynamicSurface>(options) as Promise<IRuntimePeer>
    )
    const send = vi.spyOn(fixture.transports[0]!, 'send')
    try {
      for (const field of [undefined, [], [new ArrayBuffer(1)]]) {
        const backing = new Uint8Array([1]).buffer
        const options = { transfer: field }
        const result = await Promise.resolve()
          .then<unknown>(() => {
            if (mode === 'stream') return fixture.peers[0]!.stream('echo', backing, options).next()
            if (mode === 'group')
              return fixture.peers[0]!.group([{ method: 'echo', payload: backing }], options)
            return fixture.peers[0]![mode]('echo', backing, options)
          })
          .catch((error: unknown) => error)
        assert.equal(
          (result as { code?: string })?.code,
          RpcCoreErrorCode.invalidConfig,
          '[A87] process transfer is a configuration error, including []/undefined'
        )
        assert.equal(send.mock.calls.length, 0)
        assert.equal(backing.byteLength, 1)
        assert.equal(fixture.received.length, 0)
      }
    } finally {
      send.mockRestore()
      await fixture.close()
    }
  }
)

it('[A86] tampered view-external bytes cannot consume the genuine counter, and replay cannot run the provider twice', async () => {
  const fixture = await nativePair()
  /**
   * Observe the actual first native host write without replacing crypto, replay or provider
   * dispatch.
   */
  const send = fixture.transports[0]!.send
  let genuine: unknown
  const observation = vi
    .spyOn(fixture.transports[0]!, 'send')
    .mockImplementation((message, options) => {
      const carrier = message as { frame?: { kind?: string; sidecars?: ArrayBuffer[] } }
      if (!genuine && carrier.frame?.kind === RpcNativeBinaryKind) {
        genuine = structuredClone(message)
        const tampered = structuredClone(message) as typeof carrier
        new Uint8Array(tampered.frame!.sidecars![0]!)[0] ^= 1
        send(tampered)
      }
      return send(message, options)
    })
  /** A tiny view still signs and transfers its complete original backing. */
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  try {
    const result = await fixture.peers[0]!.request('echo', new Uint8Array(backing, 1, 2), {
      transfer: [backing],
      timeoutMs: 300
    })
    assert.ok(result instanceof Uint8Array)
    assert.equal(
      fixture.received.length,
      1,
      '[A86] the subsequent genuine frame must retain its unspent counter'
    )
    await vi.waitFor(() =>
      assert.ok(
        fixture.reports.some(
          (error) => (error as { code?: string }).code === RpcCoreErrorCode.authenticationFailed
        )
      )
    )
    send(genuine)
    await vi.waitFor(() =>
      assert.equal(
        fixture.reports.filter(
          (error) => (error as { code?: string }).code === RpcCoreErrorCode.authenticationFailed
        ).length,
        2
      )
    )
    assert.equal(
      fixture.received.length,
      1,
      '[A86] only the first completely validated counter commits'
    )
    assert.equal(backing.byteLength, 0)
  } finally {
    observation.mockRestore()
    await fixture.close()
  }
})

it('[A84] an authenticated malformed native reference reports PROTOCOL_INVALID before provider', async () => {
  const fixture = await nativePair()
  /** The peer holds the real signing fixture key but still cannot bypass the closed native grammar. */
  const send = fixture.transports[0]!.send
  let corrupted = false
  const observation = vi
    .spyOn(fixture.transports[0]!, 'send')
    .mockImplementation((message, options) => {
      const carrier = message as { frame?: { kind?: string } }
      if (!corrupted && carrier.frame?.kind === RpcNativeBinaryKind) {
        corrupted = true
        const malformed = structuredClone(message) as {
          frame: {
            protectedMetadata: {
              body: { payload: { envelope: { payload: unknown } } }
              signature: string
            }
          }
        }
        malformed.frame.protectedMetadata.body.payload.envelope.payload = ['buffer', 999]
        malformed.frame.protectedMetadata.signature = fixture.signature(
          malformed.frame.protectedMetadata.body
        )
        return send(malformed, options)
      }
      return send(message, options)
    })
  const backing = new Uint8Array([1]).buffer
  try {
    await assert.rejects(
      fixture.peers[0]!.request('echo', backing, { transfer: [backing], timeoutMs: 60 }),
      { code: RpcCoreErrorCode.deadlineExceeded }
    )
    assert.equal(fixture.received.length, 0)
    assert.ok(
      fixture.reports.some(
        (error) => (error as { code?: string }).code === RpcCoreErrorCode.protocolInvalid
      ),
      '[A84] a valid signature does not turn structural corruption into an authentication diagnosis'
    )
  } finally {
    observation.mockRestore()
    await fixture.close()
  }
})

it('[A88] actual async signing mutation is rejected without treating detach as provider success', async () => {
  /** Only the fixture pauses the real signature; digest, counter, sender and receiver are unchanged. */
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const signing = new Promise<void>((resolve) => {
    started = resolve
  })
  let pause = false
  const fixture = await nativePair(async (index, value) => {
    const payload = readAuthenticationEnvelope(value).payload as { profile?: string }
    if (pause && index === 0 && payload?.profile === RpcBinaryProfile) {
      pause = false
      started()
      await held
    }
  })
  /** The sender still owns this backing while its original authentication awaits. */
  const backing = new Uint8Array([1, 2]).buffer
  pause = true
  const result = fixture.peers[0]!.request('echo', backing, {
    transfer: [backing],
    timeoutMs: 150
  }).catch((error: unknown) => error)
  try {
    await signing
    assert.equal(backing.byteLength, 2)
    new Uint8Array(backing)[0] = 9
    release()
    assert.equal(((await result) as { code?: string }).code, RpcCoreErrorCode.deadlineExceeded)
    assert.equal(
      backing.byteLength,
      0,
      '[A88] native commit occurred but does not prove valid delivery or business success'
    )
    assert.equal(fixture.received.length, 0)
    assert.ok(
      fixture.reports.some(
        (error) => (error as { code?: string }).code === RpcCoreErrorCode.authenticationFailed
      )
    )
  } finally {
    release()
    await result
    await fixture.close()
  }
})

it('[A86] retiring the real receiver during native digest prevents its original counter commit and provider', async () => {
  /**
   * This spy only delays delivery of a real WebCrypto digest result; no digest or replay owner is
   * replaced.
   */
  const subtle = globalThis.crypto.subtle
  const digest = subtle.digest
  const backing = new Uint8Array([1, 2]).buffer
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const validating = new Promise<void>((resolve) => {
    started = resolve
  })
  let active = false
  let delayed = false
  const observation = vi.spyOn(subtle, 'digest').mockImplementation(async (...args) => {
    const result = (await Reflect.apply(digest, subtle, args)) as ArrayBuffer
    if (active && !delayed && args[1] !== backing) {
      delayed = true
      started()
      await held
    }
    return result
  })
  const fixture = await nativePair()
  active = true
  const result = fixture.peers[0]!.request('echo', backing, {
    transfer: [backing],
    timeoutMs: 120
  }).catch((error: unknown) => error)
  try {
    await validating
    assert.equal(backing.byteLength, 0)
    /** Observe actual original bitmap admission after the native validation has begun. */
    const counters = vi.spyOn(authenticationReplay, 'admitAuthenticationCounter')
    try {
      await fixture.peers[1]!.close()
      release()
      assert.equal(((await result) as { code?: string }).code, RpcCoreErrorCode.deadlineExceeded)
      assert.equal(fixture.received.length, 0)
      assert.equal(
        counters.mock.calls.length,
        0,
        '[A86] a late digest cannot commit against the retired physical context'
      )
    } finally {
      counters.mockRestore()
    }
  } finally {
    release()
    await result
    observation.mockRestore()
    await fixture.close()
  }
})

it('[A87] native physical measurement never reads application properties on a backing', async () => {
  /** Only standard backing slots and raw bytes belong to a native sidecar. */
  const fixture = await nativePair()
  const backing = new Uint8Array([1, 2]).buffer
  /** A legal backing property must not become a JSON hook during budget checks. */
  let reads = 0
  Object.defineProperty(backing, 'toJSON', {
    get: () => {
      reads++
      return () => ({ application: true })
    }
  })
  try {
    const result = await fixture.peers[0]!.request('echo', backing, { transfer: [backing] })
    assert.equal(reads, 0, '[A87] complete backing measurement must use only intrinsic slots')
    assert.equal(backing.byteLength, 0)
    assert.deepEqual([...new Uint8Array(result as ArrayBuffer)], [1, 2])
    assert.equal(fixture.received.length, 1)
  } finally {
    await fixture.close()
  }
})

it('[A87] an own non-enumerable transfer option survives the simple default deadline copy', async () => {
  const fixture = await nativePair()
  const backing = new Uint8Array([1]).buffer
  /** Own presence is the documented ownership selector; enumerability cannot silently change it. */
  const options = Object.defineProperty({}, 'transfer', { value: [backing] })
  try {
    await fixture.peers[0]!.request('echo', backing, options)
    assert.equal(backing.byteLength, 0, '[A87] the original explicit list reaches native commit')
  } finally {
    await fixture.close()
  }
})

it('[A88][A68] retiring a receiver during actual binary fingerprint preparation prevents a new store claim', async () => {
  /** The external store is the real canonical implementation and survives physical retirement. */
  const retained = createRpcIdempotencyStore()
  /** Observation delegates every claim to the unchanged real store, which is deliberately frozen. */
  let claims = 0
  const observed: IRpcIdempotencyStore = {
    ...retained,
    claim: (...args) => {
      claims++
      return retained.claim(...args)
    }
  }
  const stores = [createRpcIdempotencyStore(), observed]
  const fixture = await nativePair(undefined, undefined, [capabilities, capabilities], stores)
  const subtle = globalThis.crypto.subtle
  const originalDigest = subtle.digest
  /**
   * Auth owners captured their real digest before this observer; only the later fingerprint uses
   * it.
   */
  let hashes = 0
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let started!: () => void
  const preparing = new Promise<void>((resolve) => {
    started = resolve
  })
  const observation = vi.spyOn(subtle, 'digest').mockImplementation(async (...args) => {
    const result = await Reflect.apply(originalDigest, subtle, args)
    if (++hashes === 1) {
      started()
      await held
    }
    return result
  })
  const backing = new Uint8Array([1]).buffer
  const result = fixture.peers[0]!.request('echo', backing, {
    transfer: [backing],
    idempotencyKey: 'retired-fingerprint',
    timeoutMs: 160
  }).catch((error: unknown) => error)
  try {
    assert.equal(
      await Promise.race([preparing.then(() => true), result.then(() => false)]),
      true,
      '[A68] the genuine receiver reaches its original fingerprint owner'
    )
    await fixture.peers[1]!.close()
    release()
    await result
    assert.equal(claims, 0, '[A68] retired preparation cannot publish a key claim')
    assert.equal(fixture.received.length, 0)
  } finally {
    release()
    await result
    observation.mockRestore()
    await fixture.close()
  }
})

it('[A84][A68] native keyed bytes remain part of the operation fingerprint after restoration', async () => {
  const fixture = await nativePair()
  const first = new Uint8Array([1]).buffer
  const second = new Uint8Array([2]).buffer
  try {
    await fixture.peers[0]!.request('echo', first, {
      transfer: [first],
      idempotencyKey: 'native-key'
    })
    const result = await fixture.peers[0]!.request('echo', second, {
      transfer: [second],
      idempotencyKey: 'native-key'
    }).catch((error: unknown) => error)
    assert.equal(
      (result as { code?: string })?.code,
      RpcCoreErrorCode.contractInvalid,
      '[A68] restored native values cannot fingerprint as empty JSON objects'
    )
    assert.equal(fixture.received.length, 1)
  } finally {
    await fixture.close()
  }
})

it.each(['none', 'encrypt-presence', 'missing-digest'] as const)(
  '[A87] actual native carrier refuses transfer when its canonical auth facts are %s',
  async (mode) => {
    /** This required unavailable-API case removes only digest access, without faking crypto outputs. */
    const missing =
      mode === 'missing-digest'
        ? vi
            .spyOn(globalThis.crypto, 'subtle', 'get')
            .mockReturnValue(undefined as unknown as SubtleCrypto)
        : undefined
    let fixture: Awaited<ReturnType<typeof nativePair>> | undefined
    try {
      fixture = await nativePair(
        undefined,
        undefined,
        [capabilities, capabilities],
        undefined,
        mode === 'missing-digest' ? 'sign-only' : mode
      )
      const send = vi.spyOn(fixture.transports[0]!, 'send')
      const backing = new Uint8Array([1]).buffer
      const result = await fixture.peers[0]!.request('echo', backing, {
        transfer: [backing]
      }).catch((error: unknown) => error)
      assert.equal((result as { code?: string })?.code, RpcCoreErrorCode.capabilityUnsupported)
      assert.equal(backing.byteLength, 1)
      assert.equal(send.mock.calls.length, 0)
      assert.equal(fixture.received.length, 0)
    } finally {
      missing?.mockRestore()
      await fixture?.close()
    }
  }
)

it('[A86][A87] native group transfer keeps one physical frame and one real signature for the complete group', async () => {
  /** Signatures observe the real original auth envelope, excluding directory/control traffic. */
  let signatures = 0
  const fixture = await nativePair((index, value) => {
    const payload = readAuthenticationEnvelope(value).payload as {
      profile?: string
      envelope?: { task: { mode: string } }
    }
    if (
      index === 0 &&
      payload.profile === RpcBinaryProfile &&
      payload.envelope?.task.mode === 'group'
    )
      signatures++
  })
  const send = vi.spyOn(fixture.transports[0]!, 'send')
  const backing = new Uint8Array([9, 1, 2, 8]).buffer
  try {
    const results = await fixture.peers[0]!.group(
      [
        { method: 'echo', payload: new Uint8Array(backing, 1, 2) },
        { method: 'echo', payload: backing }
      ],
      { transfer: [backing] }
    )
    assert.equal(backing.byteLength, 0)
    assert.equal(signatures, 1)
    assert.equal(
      send.mock.calls.filter(
        ([message]) =>
          (message as { frame?: { kind?: string } }).frame?.kind === RpcNativeBinaryKind
      ).length,
      1
    )
    assert.deepEqual(
      results.map((result) => result.state),
      ['success', 'success']
    )
    assert.equal(fixture.received.length, 2)
    const first = fixture.received[0] as Uint8Array
    const second = fixture.received[1] as ArrayBuffer
    assert.equal(first.buffer, second)
    assert.deepEqual([...new Uint8Array(second)], [9, 1, 2, 8])
  } finally {
    await fixture.close()
  }
})
