/** Public Host and real native carriers retain the original observer non-interference oracles. */
import { describe, expect, it, vi } from 'vitest'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { createHmac } from 'node:crypto'
import { createRpcHost, type IRpcNamespace } from '@migaia/rpc-host'
import { auth } from '@migaia/rpc-host/plugins/auth'
import { chunk } from '@migaia/rpc-host/plugins/chunk'
import { limits } from '@migaia/rpc-host/plugins/limits'
import {
  probe as probePlugin,
  defineProbe,
  RpcProbeDirection,
  RpcProbeStage,
  RpcProbeOutcome,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import {
  createRpcBackingDigest,
  createRpcMessageCarrier,
  defineTransportPlugin,
  RpcJsonCarrierCodec,
  type IRpcMessageIO
} from '@migaia/rpc-host/sdk'
import type {
  IRpcCarrier,
  IRpcCarrierWriteOptions,
  IRpcSessionHandle,
  IRpcTransportContext
} from '@migaia/rpc-contract/interfaces'
import { MemoryCarrier } from '../fixtures/core-carrier.js'
import { ProviderAdmissionRegistry } from '../../dist/features/limits/provider-admission.js'

/** One actual installed SDK context lends its original health-check port and Session handle. */
type IProbeNative = { context?: IRpcTransportContext; handle?: IRpcSessionHandle }

/** Session owns the attached carrier; the transport recipe acquired no additional resource. */
function releaseProbeTransport(): void {}

/** Install this exact original carrier; Session remains the sole handshake and health owner. */
function probeTransport(carrier: IRpcCarrier, native: IProbeNative = {}) {
  return defineTransportPlugin({
    name: `probe-native-${carrier.id}`,
    namespace: 'memory',
    open: async (context) => {
      native.context = context
      native.handle = context.attach(carrier)
      await native.handle.ready
      return { dispose: releaseProbeTransport }
    }
  })
}

/** The original physical port supplies IO; the canonical carrier owns all semantic lifecycle. */
class ProbePortIO implements IRpcMessageIO {
  /** Every listener and physical write belongs to this one acquired native port. */
  readonly #port: MessagePort

  /** Capture only the actual native resource, without a queue, sender or admission state. */
  constructor(port: MessagePort) {
    this.#port = port
  }

  /** Native structured clone receives the original backing list after actual handoff admission. */
  send(value: unknown, transfer?: readonly ArrayBuffer[], options?: IRpcCarrierWriteOptions): void {
    options?.onWriteStart?.()
    this.#port.postMessage(value, transfer as readonly ArrayBuffer[])
  }

  /** Return this exact native message subscription's original remover. */
  onMessage(listener: (value: unknown) => void): () => void {
    this.#port.on('message', listener)
    return () => {
      this.#port.off('message', listener)
    }
  }

  /** Node close carries no fabricated protocol reason or new Error instance. */
  onClose(listener: () => void): () => void {
    this.#port.on('close', listener)
    return () => {
      this.#port.off('close', listener)
    }
  }

  /** The SDK classifies the actual native messageerror without another error adapter. */
  onError(listener: (error: unknown) => void): () => void {
    this.#port.on('messageerror', listener)
    return () => {
      this.#port.off('messageerror', listener)
    }
  }

  /** Shared close completion and idempotency belong to the existing SDK carrier. */
  close(): void {
    this.#port.close()
  }
}

/** Lend actual Node port IO to the canonical carrier without encoding, routing or admission. */
function probePortCarrier(port: MessagePort, id: string, report: (error: unknown) => void) {
  return createRpcMessageCarrier({
    id,
    io: new ProbePortIO(port),
    nativeBinary: true,
    digest: createRpcBackingDigest(),
    report
  })
}

/** The same five configurations define every business/path comparison in this file. */
const probeModes = ['absent', 'recording', 'throw', 'reject', 'reentrant'] as const

/** The fixed original protection alternatives expand the same ten native transfer cases. */
const protections = ['signed', 'encrypted'] as const

/** One parameter identifies an original observer variant rather than a runtime capability. */
type IProbeMode = (typeof probeModes)[number]

/** Only the original signed and encrypted transform recipes participate in this test matrix. */
type IProbeProtection = (typeof protections)[number]

/** Each original endpoint owns its business transform counters independently. */
type IProbeTransforms = { encrypt: number; sign: number; verify: number; decrypt: number }

/** Install the original reversible string transforms with one explicit endpoint counter input. */
function encryptedAuthentication(counts: IProbeTransforms) {
  return auth({
    encodedType: 'string',
    encrypt: (value) => {
      counts.encrypt++
      return `encrypted:${JSON.stringify(value)}`
    }, // Physical wire representation.
    sign: (value) => {
      counts.sign++
      return `signed:${String(value)}`
    },
    verify: (value) => {
      counts.verify++
      expect(String(value).startsWith('signed:')).toBe(true)
      return String(value).slice('signed:'.length)
    },
    decrypt: (value) => {
      counts.decrypt++
      expect(String(value).startsWith('encrypted:')).toBe(true)
      return JSON.parse(String(value).slice('encrypted:'.length))
    } // Restore the wire representation.
  })
}

/**
 * One unchanged scenario must keep the same admitted source for reentry, fragmented capture,
 * refusal, ping and final transform accounting; splitting these phases would lose their ordering.
 */
async function encryptedProbeCase(mode: IProbeMode) {
  /** Probe failures and the actual business failure must remain distinguishable. */
  const sinkFailure = new Error('encrypted probe sink failure'),
    original = new RangeError('encrypted probe business failure')
  /** Retained views use the public explicit snapshot boundary. */
  const events: IRpcProbeEventView[] = [],
    reports: unknown[] = []
  /** A reentrant request completes before the quota refusal scenario begins. */
  let currentClient: IRpcNamespace | undefined, nested: Promise<unknown> | undefined
  /** Two genuine running providers occupy the complete supported admission budget. */
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  /** Record actual business order and the existing provider rejection reason. */
  const calls: string[] = [],
    rejections: string[] = []
  /** Transform counts observe the configured existing pipeline on each physical endpoint. */
  const transforms = {
    left: { encrypt: 0, sign: 0, verify: 0, decrypt: 0 },
    right: { encrypt: 0, sign: 0, verify: 0, decrypt: 0 }
  }
  /** All observers subscribe to the same logical and physical supported stages. */
  const probe =
    mode === 'absent'
      ? undefined
      : defineProbe({
          stages: ['message', 'envelope', 'encoded', 'frame', 'protected'],
          capture: ['frame', 'protected'],
          onError: (error) => reports.push(error),
          emit: (event) => {
            events.push(Object.freeze({ ...event }))
            if (mode === 'throw') throw sinkFailure
            if (mode === 'reject') return Promise.reject(sinkFailure)
            if (
              mode === 'reentrant' &&
              event.outcome === RpcProbeOutcome.created &&
              event.method === 'reenter' &&
              currentClient &&
              !nested
            )
              nested = currentClient.send('encrypted-server', 'echo', 'nested')
          }
        })
  /** The same real MemoryCarrier pair now lends the canonical four-stage JSON codec. */
  const leftCodec = new RpcJsonCarrierCodec(),
    rightCodec = new RpcJsonCarrierCodec()
  /** Native storage is explicitly absent on the original string-fragment path. */
  const leftWire = new MemoryCarrier('encrypted-left', undefined, leftCodec, false),
    rightWire = new MemoryCarrier('encrypted-right', undefined, rightCodec, false)
  leftWire.link(rightWire)
  rightWire.link(leftWire)
  /** The real SDK open callback retains only its own native health ports. */
  const clientNative: IProbeNative = {}
  /** Observe the existing limits owner, without constructing a substitute quota registry. */
  const admitting = vi.spyOn(ProviderAdmissionRegistry.prototype, 'acquireMany')
  /** One genuine probe handle is installed independently by each public Host. */
  const observation = probe ? [probePlugin(probe)] : []
  /** Both original native endpoints subscribe through their own SDK transport installation. */
  const [server, client] = await Promise.all([
    createRpcHost({
      self: { name: 'encrypted-server', instanceId: 'encrypted-server' },
      plugins: [
        encryptedAuthentication(transforms.right),
        chunk({ chunkBytes: 96 }),
        limits({
          maxGlobal: 2,
          maxPerPeer: 2,
          onRejected: (rejection) => {
            rejections.push(rejection.reason)
          }
        }),
        ...observation,
        probeTransport(rightWire)
      ],
      report: () => undefined,
      provide: {
        reenter: () => {
          calls.push('reenter')
          return 'ready'
        },
        echo: (data) => {
          if (data !== 'nested') calls.push('echo')
          return data
        },
        fail: () => {
          calls.push('fail')
          throw original
        },
        hold: async (data) => {
          calls.push(String(data))
          await held
          return data
        }
      }
    }),
    createRpcHost({
      self: { name: 'encrypted-client', instanceId: 'encrypted-client' },
      plugins: [
        encryptedAuthentication(transforms.left),
        chunk({ chunkBytes: 96 }),
        ...observation,
        probeTransport(leftWire, clientNative)
      ],
      report: () => undefined
    })
  ])
  currentClient = client.memory
  /** A payload spanning several real chunks must remain unchanged through encryption and capture. */
  const payload = { value: 'x'.repeat(512) }
  /** Retain original pending operations for deterministic cleanup if an assertion fails. */
  let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined
  try {
    expect(leftWire.codec).toBe(leftCodec)
    expect(rightWire.codec).toBe(rightCodec)
    expect(clientNative.handle).toBeDefined()
    expect((await clientNative.handle!.ready).extensions.has('chunk@1')).toBe(true)
    expect(await client.memory.send('encrypted-server', 'reenter', undefined)).toBe('ready')
    if (mode === 'reentrant') expect(await nested).toBe('nested')
    /** This is the actual registry on which the real installed limits stage acquired. */
    const admission = admitting.mock.contexts.find(
      (value): value is ProviderAdmissionRegistry => value instanceof ProviderAdmissionRegistry
    )!
    await vi.waitFor(() => expect(admission.size).toBe(0))
    events.length = 0
    /** Only this one logical echo crosses the counters before its original response settles. */
    const beforeEcho = {
      left: { ...transforms.left },
      right: { ...transforms.right }
    }
    expect(
      await client.memory.send('encrypted-server', 'echo', payload, {
        trace: 'encrypted-explicit'
      })
    ).toEqual(payload)
    expect(payload).toEqual({ value: 'x'.repeat(512) })
    /** The fixed left/right endpoint pair protects and restores this logical echo once per side. */
    for (const side of ['left', 'right'] as const) {
      expect(transforms[side].encrypt - beforeEcho[side].encrypt).toBe(1)
      expect(transforms[side].sign - beforeEcho[side].sign).toBe(1)
      expect(transforms[side].verify - beforeEcho[side].verify).toBe(1)
      expect(transforms[side].decrypt - beforeEcho[side].decrypt).toBe(1)
    }
    await vi.waitFor(() => expect(admission.size).toBe(0))
    if (mode !== 'absent') {
      /** R16/R23 authenticate once after the same actual fragments have been reassembled. */
      const inbound = events.filter(
        (event) =>
          event.endpointId === 'encrypted-server' &&
          event.direction === RpcProbeDirection.inbound &&
          event.stage !== RpcProbeStage.message
      )
      const frameCount = inbound.filter((event) => event.stage === RpcProbeStage.frame).length
      expect(frameCount).toBeGreaterThan(1)
      expect(inbound.map((event) => event.stage)).toEqual([
        ...Array.from({ length: frameCount }, () => RpcProbeStage.frame),
        RpcProbeStage.encoded,
        RpcProbeStage.protected,
        RpcProbeStage.envelope
      ])
      for (let index = 0; index < frameCount; index++) {
        expect(inbound[index]!.content === inbound[frameCount + 1]!.content).toBe(false)
        expect(inbound[index]!.seq).toBeLessThan(inbound[frameCount + 1]!.seq)
        expect(inbound[index]).toMatchObject({
          chunkIndex: index,
          chunkCount: frameCount
        })
      }
    }
    /** BC3 restores the same original native business graph directly, without the Peer wrapper. */
    const failure = await client.memory
      .send('encrypted-server', 'fail', undefined)
      .catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(RangeError)
    expect(failure).toMatchObject({
      code: 'INTERNAL',
      name: original.name,
      message: original.message,
      stack: original.stack
    })
    await vi.waitFor(() => expect(admission.size).toBe(0))
    first = client.memory.send('encrypted-server', 'hold', 'hold-a')
    second = client.memory.send('encrypted-server', 'hold', 'hold-b')
    await vi.waitFor(() => expect(admission.size).toBe(2))
    const rejected = await client.memory
      .send('encrypted-server', 'echo', 'denied')
      .catch((error: unknown) => error)
    expect(rejected).toBeInstanceOf(Error)
    expect(rejected).toMatchObject({ source: 'rpc.endpoint', code: 'OVERLOADED' })
    expect(rejections).toEqual(['concurrency'])
    await expect(
      clientNative.context!.ping(clientNative.handle!, { timeoutMs: 1000 })
    ).resolves.toBeUndefined()
    release()
    expect(await Promise.all([first, second])).toEqual(['hold-a', 'hold-b'])
    expect(calls).toEqual(['reenter', 'echo', 'fail', 'hold-a', 'hold-b'])
    await vi.waitFor(() => expect(admission.size).toBe(0))
    expect(transforms.left.encrypt).toBeGreaterThan(1)
    expect(transforms.left.encrypt).toBe(transforms.left.sign)
    expect(transforms.right.verify).toBe(transforms.left.sign)
    expect(transforms.right.decrypt).toBe(transforms.right.verify)
    expect(transforms.right.encrypt).toBe(transforms.right.sign)
    expect(transforms.left.verify).toBe(transforms.right.sign)
    expect(transforms.left.decrypt).toBe(transforms.left.verify)
    if (mode === 'throw' || mode === 'reject')
      expect(reports.every((error) => Reflect.get(error as object, 'cause') === sinkFailure)).toBe(
        true
      )
    else expect(reports).toEqual([])
  } finally {
    release()
    await Promise.allSettled([first, second])
    admitting.mockRestore()
    await Promise.all([client.close(), server.close()])
  }
}

/** Exercise actual backing transfer or the original encrypted refusal on the same native source. */
async function nativeTransferProbeCase(protection: IProbeProtection, mode: IProbeMode) {
  /** Genuine Node ports provide the existing clone/transfer capability and detach semantics. */
  const ports = new MessageChannel()
  /** The existing observer report retains failures separately from business results. */
  const reports: unknown[] = [],
    businessReports: unknown[] = []
  /** Only the genuine provider counts application binary execution. */
  let executions = 0,
    client: IRpcNamespace | undefined,
    nested: Promise<unknown> | undefined
  /** Each sink receives the real endpoint events without an alternate emitter. */
  const probe =
    mode === 'absent'
      ? undefined
      : defineProbe({
          stages: ['message', 'envelope', 'encoded', 'frame', 'protected'],
          onError: (error) => reports.push(error),
          emit: (event) => {
            if (mode === 'throw') throw new Error('transfer sink failure')
            if (mode === 'reject') return Promise.reject(new Error('transfer sink failure'))
            if (
              mode === 'reentrant' &&
              event.outcome === RpcProbeOutcome.created &&
              event.method === 'reenter' &&
              client &&
              !nested
            )
              nested = client.send('transfer-right', 'reenter')
          }
        })
  /** Fixture signing covers the exact transmitted metadata, including native backing digests. */
  const sign = (value: unknown) => ({
    value,
    signature: createHmac('sha256', 'probe-transfer-fixture')
      .update(JSON.stringify(value))
      .digest('hex')
  }) // Wire-signature representation.
  /** Verification uses the same existing boundary representation after actual structured clone. */
  const verify = (value: unknown) => {
    const signed = value as ReturnType<typeof sign>
    expect(signed.signature).toBe(
      createHmac('sha256', 'probe-transfer-fixture')
        .update(JSON.stringify(signed.value))
        .digest('hex')
    )
    return signed.value
  }
  /** Retain the original encrypted-transfer refusal without inventing a fixture capability gate. */
  const authenticationConfig =
    protection === 'signed'
      ? { sign, verify }
      : {
          sign,
          verify,
          encrypt: (value: unknown) => JSON.stringify(value),
          decrypt: (value: unknown) => JSON.parse(String(value))
        } // Encrypted wire representation.
  /** Both canonical carriers observe actual native cloning and transfer on the original ports. */
  const leftWire = probePortCarrier(ports.port1, 'transfer-left', (error) =>
      businessReports.push(error)
    ),
    rightWire = probePortCarrier(ports.port2, 'transfer-right', (error) =>
      businessReports.push(error)
    )
  /** Opaque auth/observer definitions are installed by each real receiving native Host. */
  const observation = probe ? [probePlugin(probe)] : []
  /** The same two physical endpoints are independently owned, with no static agreement shim. */
  const peers = await Promise.all([
    createRpcHost({
      self: { name: 'left', instanceId: 'transfer-left' },
      plugins: [auth(authenticationConfig), ...observation, probeTransport(leftWire)],
      report: (error) => businessReports.push(error)
    }),
    createRpcHost({
      self: { name: 'right', instanceId: 'transfer-right' },
      plugins: [auth(authenticationConfig), ...observation, probeTransport(rightWire)],
      report: (error) => businessReports.push(error),
      provide: {
        reenter: () => 9,
        echo: (value: unknown) => {
          executions++
          return value
        }
      }
    })
  ])
  client = peers[0]!.memory
  /** This original application backing must detach only after a supported physical transfer. */
  const bytes = new Uint8Array([4, 5, 6]),
    backing = bytes.buffer
  try {
    expect(await client.send('transfer-right', 'reenter')).toBe(9)
    if (mode === 'reentrant') expect(await nested).toBe(9)
    const result = await client
      .send('transfer-right', 'echo', { bytes }, { transfer: [backing] })
      .catch((error: unknown) => error)
    if (protection === 'signed') {
      expect(result).toMatchObject({ bytes: new Uint8Array([4, 5, 6]) })
      expect(backing.byteLength).toBe(0)
      expect(executions).toBe(1)
    } else {
      expect(result).toMatchObject({
        source: 'rpc.endpoint',
        code: 'CAPABILITY_UNSUPPORTED'
      })
      expect(backing.byteLength).toBe(3)
      expect(Array.from(bytes)).toEqual([4, 5, 6])
      expect(executions).toBe(0)
      /** Media restriction keeps ordinary encrypted binary calls on the existing inline codec path. */
      expect(await client.send('transfer-right', 'echo', { bytes })).toMatchObject({
        bytes: new Uint8Array([4, 5, 6])
      })
      expect(backing.byteLength).toBe(3)
      expect(executions).toBe(1)
    }
    expect(businessReports).toEqual([])
    if (mode === 'throw' || mode === 'reject') expect(reports.length).toBeGreaterThan(0)
    else expect(reports).toEqual([])
  } finally {
    await Promise.all(peers.map((peer) => peer.close()))
    ports.port1.close()
    ports.port2.close()
  }
}

describe('probe non-interference', () => {
  it.each(probeModes)(
    'preserves encrypted chunk flow, admission rejection and ping with %s probe',
    encryptedProbeCase
  )
})

describe.each(protections)('probe non-interference real MessagePort %s transfer', (protection) => {
  it.each(probeModes)(
    'preserves native transfer admission and byte ownership with %s probe',
    (mode) => nativeTransferProbeCase(protection, mode)
  )
})
