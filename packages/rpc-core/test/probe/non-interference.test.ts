import { describe, expect, it, vi } from 'vitest'
import { MessageChannel } from 'node:worker_threads'
import { createHmac } from 'node:crypto'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import {
  createStringFramer,
  messageFramerV1,
  readRpcBatchMembers
} from '@migaia/rpc-contract/framing'
import { systemScheduler } from '@migaia/utils/scheduler'
import { createEndpoint, connect, abort, ping } from '../../dist/core/index.js'
import { codec } from '../../dist/core/middleware/codec.js'
import { framer } from '../../dist/core/middleware/framer.js'
import { authentication } from '../../dist/core/middleware/authentication.js'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { createNodeMessagePortTransport } from '../../dist/core/adapters/message-port.js'
import { createRuntimePeer } from '../../dist/remote/runtime-api/peer.js'
import {
  defineProbe,
  probePlugin,
  snapshotProbeEvent,
  RpcProbeDirection,
  RpcProbeStage,
  RpcProbeOutcome,
  type IRpcProbeEventView
} from '../../dist/core/probe/index.js'
import { readEndpointOwner } from '../../dist/core/internal/endpoint-projection.js'
import { readRuntimePeerConnection } from '../../dist/remote/runtime-api/peer.js'
import type { RpcOutboundAttachment } from '../../dist/core/internal/outbound-attachment.js'
import { runtimeSources, RUNTIME_API_FIXTURE_BASE_CAPABILITIES } from '../runtime-api/fixture.js'
import { RpcCapability } from '@migaia/rpc-contract'
import { RpcRemoteError, RpcTimeoutError, RpcAbortError } from '../../dist/core/errors.js'
import { registerBatchAgreement } from '../../dist/core/internal/batch-frame.js'
import type { RpcOutboundSender } from '../../dist/core/internal/outbound-sender.js'
import type { ProviderAdmissionRegistry } from '../../dist/core/internal/provider-admission.js'

/** The same five configurations define every business/path comparison in this file. */
const probeModes = ['absent', 'recording', 'throw', 'reject', 'reentrant'] as const

describe('probe non-interference', () => {
  it.each(probeModes)(
    'preserves runtime results, business error chain, 64 calls and path state with %s probe',
    async (mode) => {
      /** One native cause distinguishes probe isolation from business error replacement. */
      const original = new RangeError('probe isolation business failure')
      /** The probe's own failure must never become the caller result. */
      const sinkFailure = new Error('probe isolation sink failure')
      /** Real ignored business work allows the original caller timeout and abort to win. */
      let release!: () => void
      const held = new Promise<void>((resolve) => {
        release = resolve
      })
      /** Real provider call order remains independent of observation callbacks. */
      const calls: number[] = []
      /** Re-entrancy uses the genuine Peer request API and is triggered only once. */
      let client: Awaited<ReturnType<typeof createRuntimePeer>>,
        nested: Promise<unknown> | undefined
      let count = 0
      const reports: unknown[] = []
      /** The existing Peer diagnostic owner retains the genuine business error reference. */
      const businessReports: unknown[] = []
      const probe =
        mode === 'absent'
          ? undefined
          : defineProbe({
              stages: ['message', 'envelope', 'encoded', 'frame', 'protected'],
              onError: (error) => reports.push(error),
              emit: (event: IRpcProbeEventView) => {
                count++
                if (mode === 'throw') throw sinkFailure
                if (mode === 'reject') return Promise.reject(sinkFailure)
                if (
                  mode === 'reentrant' &&
                  event.outcome === RpcProbeOutcome.created &&
                  event.method === 'reenter' &&
                  client &&
                  !nested
                )
                  nested = client.request('echo', -1)
              }
            })
      const capabilities = [
        ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
        RpcCapability.generation,
        RpcCapability.deadline
      ]
      const channel = runtimeSources(capabilities, capabilities)
      const peers = await Promise.all([
        createRuntimePeer({
          connect: channel.sources[0],
          probe,
          report: (error) => businessReports.push(error)
        }),
        createRuntimePeer({
          connect: channel.sources[1],
          probe,
          report: (error) => businessReports.push(error),
          provide: {
            reenter: () => 9,
            hold: async () => {
              await held
              return 9
            },
            echo: (value: number) => {
              if (value >= 0) calls.push(value)
              return value
            },
            fail: () => {
              throw original
            },
            values: async function* () {
              yield 1
              yield 2
              yield 3
            }
          }
        })
      ])
      client = peers[0]
      /**
       * Observe the existing physical transport, retaining its original receiver and
       * implementation.
       */
      const sending = vi.spyOn(channel.transports[0], 'send')
      /** These actual selected component references are the established fast/batch path facts. */
      const sender = readEndpointOwner<RpcOutboundSender>(
        readRuntimePeerConnection(client).endpoint,
        'outbound-pipeline'
      )!
      try {
        expect(sender.components.codec.encode).toBe(identityCodec.encode)
        expect(sender.components.framer.frame).toBe(messageFramerV1.frame)
        /** Re-entrancy is isolated from quota saturation before the exact 64-call batch. */
        expect(await client.request('reenter')).toBe(9)
        if (mode === 'reentrant') expect(await nested).toBe(-1)
        sending.mockClear()
        expect(
          await Promise.all(Array.from({ length: 64 }, (_, value) => client.request('echo', value)))
        ).toEqual(Array.from({ length: 64 }, (_, value) => value))
        expect(calls).toEqual(Array.from({ length: 64 }, (_, value) => value))
        /**
         * Genuine batch members prove c64 kept batching rather than producing 64 independent
         * writes.
         */
        const batches = sending.mock.calls.map(([frame]) => readRpcBatchMembers(frame))
        expect(batches.some((members) => members !== undefined && members.length > 1)).toBe(true)
        expect(sending.mock.calls.length).toBeLessThan(64)
        expect(batches.reduce((total, members) => total + (members?.length ?? 1), 0)).toBe(64)
        /**
         * Plain Peer calls retain their original fast lane and remote wrapper with the native
         * cause.
         */
        const error = await client.request('fail').catch((failure: unknown) => failure)
        expect(error).toBeInstanceOf(RpcRemoteError)
        expect(error).toMatchObject({
          code: 'INTERNAL',
          cause: { name: original.name, message: original.message, stack: original.stack }
        })
        expect(Reflect.get(error as object, 'cause')).toBeInstanceOf(RangeError)
        expect(businessReports).toContain(original)
        /** Timeout preserves its original native type and code in every observer configuration. */
        const timeout = await client
          .request('hold', undefined, { timeoutMs: 10 })
          .catch((failure: unknown) => failure)
        expect(timeout).toBeInstanceOf(RpcTimeoutError)
        expect(timeout).toMatchObject({ source: 'rpc.endpoint', code: 'DEADLINE_EXCEEDED' })
        /** Caller cancellation keeps the exact native reason rather than any probe failure. */
        const controller = new AbortController(),
          reason = new RangeError('probe isolation abort reason')
        const aborted = client
          .request('hold', undefined, { signal: controller.signal })
          .catch((failure: unknown) => failure)
        controller.abort(reason)
        const abortError = await aborted
        expect(abortError).toBeInstanceOf(RpcAbortError)
        expect(abortError).toMatchObject({ source: 'rpc.endpoint', code: 'CANCELLED' })
        expect(Reflect.get(abortError as object, 'cause')).toBe(reason)
        release()
        expect(await client.notify('echo', -2)).toBeUndefined()
        const values: unknown[] = []
        for await (const value of client.stream('values')) values.push(value)
        expect(values).toEqual([1, 2, 3])
        await nested
        /** Package-owned snapshots prove no pending owner or replay state is leaked by observation. */
        const attachment = readEndpointOwner<RpcOutboundAttachment>(
          readRuntimePeerConnection(client).endpoint,
          'outbound-attachment'
        )!
        expect(attachment.debugSnapshot().pending).toBe(0)
        if (mode === 'absent') expect(count).toBe(0)
        else expect(count).toBeGreaterThan(0)
        if (mode === 'throw' || mode === 'reject') expect(reports.length).toBeGreaterThan(0)
        else expect(reports).toEqual([])
      } finally {
        release()
        sending.mockRestore()
        await Promise.all(peers.map((peer) => peer.close()))
        channel.close()
      }
    }
  )

  it.each(probeModes)(
    'preserves encrypted chunk flow, admission rejection and ping with %s probe',
    async (mode) => {
      /** Probe failures and the actual business failure must remain distinguishable. */
      const sinkFailure = new Error('encrypted probe sink failure'),
        original = new RangeError('encrypted probe business failure')
      /** Retained views use the public explicit snapshot boundary. */
      const events: IRpcProbeEventView[] = [],
        reports: unknown[] = []
      /** A reentrant request completes before the quota refusal scenario begins. */
      let currentClient: Awaited<ReturnType<typeof createEndpoint>> | undefined,
        nested: Promise<unknown> | undefined
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
                events.push(snapshotProbeEvent(event))
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
      /** Real reference endpoints retain their ordinary subscription and source ownership. */
      const [leftWire, rightWire] = createMemoryTransportPair()
      /** One canonical descriptor pair is the declared chunk path in every configuration. */
      const json = defineJsonCodec({ version: 1 }),
        chunks = createStringFramer({ chunkBytes: 96 }),
        serverChunks = createStringFramer({ chunkBytes: 96 })
      /** Reversible fixture transforms model the real encrypt/sign representation boundaries. */
      const protectedMiddleware = (side: 'left' | 'right') =>
        authentication({
          encodedType: 'string',
          encrypt: (value) => {
            transforms[side].encrypt++
            return `encrypted:${JSON.stringify(value)}`
          }, // Physical wire representation.
          sign: (value) => {
            transforms[side].sign++
            return `signed:${String(value)}`
          },
          verify: (value) => {
            transforms[side].verify++
            expect(String(value).startsWith('signed:')).toBe(true)
            return String(value).slice('signed:'.length)
          },
          decrypt: (value) => {
            transforms[side].decrypt++
            expect(String(value).startsWith('encrypted:')).toBe(true)
            return JSON.parse(String(value).slice('encrypted:'.length))
          } // Restore the wire representation.
        })
      /** Provider execution remains owned by the original public Core endpoint. */
      const server = await createEndpoint({
        id: 'encrypted-server',
        transport: rightWire,
        middlewares: [
          codec(json),
          framer(serverChunks),
          protectedMiddleware('right'),
          connect(),
          abort(),
          ping(),
          ...(probe ? [probePlugin(probe)] : [])
        ],
        providerLimits: {
          maxGlobal: 2,
          maxPerPeer: 2,
          onRejected: (rejection) => {
            rejections.push(rejection.reason)
          }
        },
        provider: {
          reenter: (context) => {
            calls.push('reenter')
            return context.success('ready')
          },
          echo: (context) => {
            if (context.data !== 'nested') calls.push('echo')
            return context.success(context.data)
          },
          fail: () => {
            calls.push('fail')
            throw original
          },
          hold: async (context) => {
            calls.push(String(context.data))
            await held
            return context.success(context.data)
          }
        }
      })
      const client = await createEndpoint({
        id: 'encrypted-client',
        transport: leftWire,
        middlewares: [
          codec(json),
          framer(chunks),
          protectedMiddleware('left'),
          connect(),
          abort(),
          ping(),
          ...(probe ? [probePlugin(probe)] : [])
        ]
      })
      currentClient = client
      /** The existing admission registry supplies cleanup facts without a substitute quota owner. */
      const admission = readEndpointOwner<ProviderAdmissionRegistry>(server, 'provider-admission')!
      /** Package-owned selected descriptors prove installing a probe retains the same chunk path. */
      const sender = readEndpointOwner<RpcOutboundSender>(client, 'outbound-pipeline')!
      /**
       * A payload spanning several real chunks must remain unchanged through encryption and
       * capture.
       */
      const payload = { value: 'x'.repeat(512) }
      /** Retain original pending operations for deterministic cleanup if an assertion fails. */
      let first: Promise<unknown> | undefined, second: Promise<unknown> | undefined
      try {
        expect(sender.components.codec.id).toBe(json.id)
        expect(sender.components.framer.id).toBe(chunks.id)
        expect(await client.send('encrypted-server', 'reenter', undefined)).toBe('ready')
        if (mode === 'reentrant') expect(await nested).toBe('nested')
        await vi.waitFor(() => expect(admission.size).toBe(0))
        events.length = 0
        expect(
          await client.send('encrypted-server', 'echo', payload, { trace: 'encrypted-explicit' })
        ).toEqual(payload)
        expect(payload).toEqual({ value: 'x'.repeat(512) })
        await vi.waitFor(() => expect(admission.size).toBe(0))
        if (mode !== 'absent') {
          /**
           * Existing concurrent unprotect starts all ciphertext observations before plaintext
           * resumes.
           */
          const inbound = events.filter(
            (event) =>
              event.endpointId === 'encrypted-server' &&
              event.direction === RpcProbeDirection.inbound &&
              event.stage !== RpcProbeStage.message
          )
          const frameCount = inbound.filter((event) => event.stage === RpcProbeStage.frame).length
          expect(frameCount).toBeGreaterThan(1)
          expect(inbound.map((event) => event.stage)).toEqual([
            ...Array.from({ length: frameCount }, () => RpcProbeStage.protected),
            ...Array.from({ length: frameCount }, () => RpcProbeStage.frame),
            RpcProbeStage.encoded,
            RpcProbeStage.envelope
          ])
          for (let index = 0; index < frameCount; index++) {
            expect(inbound[index]!.content === inbound[frameCount + index]!.content).toBe(false)
            expect(inbound[index]!.seq).toBeLessThan(inbound[frameCount + index]!.seq)
            expect(inbound[frameCount + index]).toMatchObject({
              chunkIndex: index,
              chunkCount: frameCount
            })
          }
        }
        /** The existing remote wrapper still exposes the same serialized native business cause. */
        const failure = await client
          .send('encrypted-server', 'fail', undefined)
          .catch((error: unknown) => error)
        expect(failure).toBeInstanceOf(RpcRemoteError)
        expect(failure).toMatchObject({
          code: 'INTERNAL',
          cause: { name: original.name, message: original.message, stack: original.stack }
        })
        await vi.waitFor(() => expect(admission.size).toBe(0))
        first = client.send('encrypted-server', 'hold', 'hold-a')
        second = client.send('encrypted-server', 'hold', 'hold-b')
        await vi.waitFor(() => expect(admission.size).toBe(2))
        const rejected = await client
          .send('encrypted-server', 'echo', 'denied')
          .catch((error: unknown) => error)
        expect(rejected).toBeInstanceOf(RpcRemoteError)
        expect(rejected).toMatchObject({ source: 'rpc.endpoint', code: 'OVERLOADED' })
        expect(rejections).toEqual(['concurrency'])
        expect(await client.ping('encrypted-server', undefined, { timeoutMs: 1000 })).toBe(true)
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
          expect(
            reports.every((error) => Reflect.get(error as object, 'cause') === sinkFailure)
          ).toBe(true)
        else expect(reports).toEqual([])
      } finally {
        release()
        await Promise.allSettled([first, second])
        await Promise.all([client.dispose(), server.dispose()])
      }
    }
  )

  describe.each(['signed', 'encrypted'] as const)('real MessagePort %s transfer', (protection) => {
    it.each(probeModes)(
      'preserves native transfer admission and byte ownership with %s probe',
      async (mode) => {
        /** Genuine Node ports provide the existing clone/transfer capability and detach semantics. */
        const ports = new MessageChannel(),
          leftWire = createNodeMessagePortTransport(ports.port1),
          rightWire = createNodeMessagePortTransport(ports.port2)
        /**
         * Both static sources explicitly agree on the supported authentication/binary capability
         * set.
         */
        const capabilities = [
          ...RUNTIME_API_FIXTURE_BASE_CAPABILITIES,
          RpcCapability.generation,
          RpcCapability.deadline,
          RpcCapability.portableBinary,
          ...(protection === 'signed' ? [RpcCapability.nativeBinary, RpcCapability.transfer] : [])
        ]
        registerBatchAgreement(leftWire, capabilities)
        registerBatchAgreement(rightWire, capabilities)
        /** The existing observer report retains failures separately from business results. */
        const reports: unknown[] = [],
          businessReports: unknown[] = []
        /** Only the genuine provider counts application binary execution. */
        let executions = 0,
          client: Awaited<ReturnType<typeof createRuntimePeer>>,
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
                    nested = client.request('reenter')
                }
              })
        /** Fixture signing covers the exact transmitted metadata, including native backing digests. */
        const sign = (value: unknown) => ({
          value,
          signature: createHmac('sha256', 'probe-transfer-fixture')
            .update(JSON.stringify(value))
            .digest('hex')
        }) // Wire-signature representation.
        /**
         * Verification uses the same existing boundary representation after actual structured
         * clone.
         */
        const verify = (value: unknown) => {
          const signed = value as ReturnType<typeof sign>
          expect(signed.signature).toBe(
            createHmac('sha256', 'probe-transfer-fixture')
              .update(JSON.stringify(signed.value))
              .digest('hex')
          )
          return signed.value
        }
        /**
         * Encryption deliberately withdraws native transfer, as the existing canonical owner
         * requires.
         */
        const authenticationConfig =
          protection === 'signed'
            ? { sign, verify }
            : {
                sign,
                verify,
                encrypt: (value: unknown) => JSON.stringify(value),
                decrypt: (value: unknown) => JSON.parse(String(value))
              } // Encrypted wire representation.
        /**
         * Explicit static source endpoints are the same public Peer factory used by production
         * adapters.
         */
        const peers = await Promise.all([
          createRuntimePeer({
            self: { name: 'left', instanceId: 'transfer-left' },
            authentication: authenticationConfig,
            probe,
            report: (error) => businessReports.push(error),
            connect: async () => ({
              transport: leftWire,
              peerId: 'transfer-right',
              scheduler: systemScheduler,
              agreement: { source: 'static', codec: identityCodec.id, capabilities },
              pipeline: { codec: identityCodec, framer: messageFramerV1 },
              features: [],
              close: async () => ports.port1.close()
            })
          }),
          createRuntimePeer({
            self: { name: 'right', instanceId: 'transfer-right' },
            authentication: authenticationConfig,
            probe,
            report: (error) => businessReports.push(error),
            provide: {
              reenter: () => 9,
              echo: (value: unknown) => {
                executions++
                return value
              }
            },
            connect: async () => ({
              transport: rightWire,
              peerId: 'transfer-left',
              scheduler: systemScheduler,
              agreement: { source: 'static', codec: identityCodec.id, capabilities },
              pipeline: { codec: identityCodec, framer: messageFramerV1 },
              features: [],
              close: async () => ports.port2.close()
            })
          })
        ])
        client = peers[0]
        /** This original application backing must detach only after a supported physical transfer. */
        const bytes = new Uint8Array([4, 5, 6]),
          backing = bytes.buffer
        try {
          expect(await client.request('reenter')).toBe(9)
          if (mode === 'reentrant') expect(await nested).toBe(9)
          const result = await client
            .request('echo', { bytes }, { transfer: [backing] })
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
    )
  })
})
