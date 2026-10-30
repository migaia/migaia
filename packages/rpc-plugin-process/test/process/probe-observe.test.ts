import { PassThrough } from 'node:stream'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, type IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import type { IRpcCarrier, IRpcCarrierFrame } from '@migaia/rpc-contract/interfaces'
import { deferred } from '@migaia/utils/promise'
import { sendQueueFeature, IpcSendClass } from '@migaia/rpc-plugin-process/features'
import type { IIpcSendQueueExecution } from '../../dist/features/send-queue.js'
import { createProcessCarrier } from '../../dist/process/carrier.js'
import { createAdapterChildStdio } from '../../dist/process/node-io.js'
import type { IProcessByteChannel, IProcessMessageChannel } from '../../dist/process/types.js'

/** Native ports lend original message, close and write operations to the Process carrier. */
function messagePortIO(port: MessagePort): IProcessMessageChannel {
  return {
    kind: 'message',
    send: (value) => port.postMessage(value),
    onMessage(listener) {
      port.on('message', listener)
      return () => {
        port.off('message', listener)
      }
    },
    onClose(listener) {
      /** Node close supplies no Process terminal reason. */
      const closed = (): void => listener()
      port.on('close', closed)
      return () => {
        port.off('close', closed)
      }
    },
    close: () => port.close()
  }
}

/** Cold probes call the carrier directly without installing a Host observation plugin. */
const probe = (): void => undefined

/** Real native plugins attach original carriers to the sole Host Session owner. */
class NativeObservationPair {
  /** Only actual Process construction publishes these original carrier receipts. */
  readonly carriers: IRpcCarrier[] = []
  /** Native resources stay separate from their Host Session and observation owners. */
  readonly #raw: readonly (IProcessByteChannel | IProcessMessageChannel)[]
  /** Actual accepted Hosts own their original physical retirement transactions. */
  #hosts: readonly { close(): Promise<void> }[] = []

  /** Retain the original acquired native channels without constructing a codec or handshake. */
  constructor(raw: readonly (IProcessByteChannel | IProcessMessageChannel)[]) {
    this.#raw = raw
  }
  /** Distinct native definitions complete their real startup concurrently. */
  async open(): Promise<this> {
    this.#hosts = await Promise.all(
      this.#raw.map((channel, index) => this.#openHost(channel, index))
    )
    return this
  }
  /** A genuine plugin lends its actual setup context directly to the canonical Process factory. */
  #openHost(channel: IProcessByteChannel | IProcessMessageChannel, index: number) {
    return createRpcHost({
      self: { name: `peer-${index}`, instanceId: `peer-${index}` },
      plugins: [
        defineTransportPlugin({
          name: `process-observe-${index}`,
          namespace: 'process',
          open: (context) => this.#attach(context, channel, index)
        })
      ],
      report: () => undefined
    })
  }
  /** Session performs genuine hello/accept on this same native IO before observation is exercised. */
  async #attach(
    context: IRpcTransportSetupContext,
    channel: IProcessByteChannel | IProcessMessageChannel,
    index: number
  ) {
    /** The canonical owner supplies observation and the original physical lifetime. */
    const carrier = createProcessCarrier(channel, context, { id: `probe-${index}` })
    this.carriers[index] = carrier
    /** The same Session retains codec, handshake and retirement ownership. */
    const handle = context.attach(carrier)
    await handle.ready
    return { dispose: () => context.detach(handle) }
  }
  /** Join the same accepted Host owners rather than managing a second carrier lifecycle. */
  async close(): Promise<void> {
    await Promise.all(this.#hosts.map((host) => host.close()))
  }
}

describe('process carrier observation', () => {
  it('byte transport exposes direct observe after the genuine handshake', async () => {
    /** Actual streams borrow the same SDK byte lifecycle as Process stdio and socket adapters. */
    const towardLeft = new PassThrough()
    /** The opposite native stream retains each writer's original byte order. */
    const towardRight = new PassThrough()
    /** Both native physical owners share Node's idempotent destruction. */
    const close = (): void => {
      towardLeft.destroy()
      towardRight.destroy()
    }
    /** Each actual native adapter owns its original observation and SDK byte lifecycle. */
    const left = createAdapterChildStdio({ stdout: towardLeft, stdin: towardRight })
    /** The opposite side reads only bytes physically written by its peer. */
    const right = createAdapterChildStdio({ stdout: towardRight, stdin: towardLeft })
    /** Actual native startup completes before either observation is exercised. */
    const pair = await new NativeObservationPair([left, right]).open()
    try {
      expect(pair.carriers[0]!.observation?.subscribe).toBeTypeOf('function')
      expect(pair.carriers[1]!.observation?.subscribe).toBeTypeOf('function')
      /** The actual native carrier alone grants bounded closing writes and Process liquidation. */
      const original = new Error('actual byte quota refusal')
      expect(pair.carriers[0]!.closingWrites).toBe(true)
      expect(pair.carriers[0]!.mapRetirement!('liquidated', original)).toMatchObject({
        code: 'PROCESS_LIQUIDATED',
        cause: original
      })
      expect(pair.carriers[0]!.mapRetirement!('idle', original)).toBe(original)
      /** Direct observation preserves the original repeated-removal contract. */
      const dispose = pair.carriers[0]!.observation!.subscribe(probe)
      dispose()
      dispose()
    } finally {
      await pair.close()
      close()
    }
  })

  it('whole-message transport exposes direct observe for Electron', async () => {
    /** Actual whole-message ports exercise this native shape without a retired static agreement. */
    const ports = new MessageChannel()
    /** Core performs the sole semantic handshake on the two original native ports. */
    const pair = await new NativeObservationPair([
      messagePortIO(ports.port1),
      messagePortIO(ports.port2)
    ]).open()
    try {
      expect(pair.carriers[0]!.observation?.subscribe).toBeTypeOf('function')
      /** Whole-message Process sources publish the same genuine transport capability and mapper. */
      const original = new Error('actual message quota refusal')
      expect(pair.carriers[0]!.closingWrites).toBe(true)
      expect(pair.carriers[0]!.mapRetirement!('liquidated', original)).toMatchObject({
        code: 'PROCESS_LIQUIDATED',
        cause: original
      })
      expect(pair.carriers[0]!.mapRetirement!('idle', original)).toBe(original)
      /** The cold probe still calls observe directly without a Host probe plugin. */
      const dispose = pair.carriers[0]!.observation!.subscribe(probe)
      dispose()
      dispose()
    } finally {
      await pair.close()
      ports.port1.close()
      ports.port2.close()
    }
  })
})

/** Acquire one standalone public queue and one bare native carrier under the genuine source context. */
function openCustodyCarrier(context: IRpcTransportSetupContext, raw: IProcessMessageChannel) {
  /** No feature queue is installed inside this carrier; the standalone queue is the only owner. */
  const carrier = createProcessCarrier(raw, context, { id: 'custody-fast', features: {} })
  /** These are the same actual connection facts normally lent by ProcessCarrierFeatures. */
  const installed = (context.owner.features.queue as IIpcSendQueueExecution).install({
    owner: context.namespace,
    namespace: context.namespace,
    signal: context.signal,
    report: context.report,
    connectionId: carrier.id
  })
  return {
    carrier,
    installed,
    /** Return both original receipts without installing a second close or completion owner. */
    async dispose() {
      installed.dispose()
      await carrier.close()
      await installed.value.whenIdle()
    }
  }
}

it('C005 standalone Process composition admits once before native start and physical write', async () => {
  /** Actual native ports supply the original whole-message send and delivery operations. */
  const ports = new MessageChannel()
  /** The same four original predicates observe only production-owner callback entry. */
  const order: string[] = []
  /** Existing native IO remains the sole writer; this callback only records its real invocation. */
  const native = messagePortIO(ports.port1)
  /** The production message carrier receives this original passthrough IO object. */
  const raw: IProcessMessageChannel = {
    ...native,
    send(value, transfer, write) {
      order.push('write')
      return native.send(value, transfer, write)
    }
  }
  /** Only actual source setup publishes the two genuine public component receipts. */
  const acquired = deferred<ReturnType<typeof openCustodyCarrier>>()
  /** Native delivery independently proves that the counted writer performs real IO. */
  const received = deferred<unknown>()
  /** This exact native listener is removed on both actual delivery and fixture shutdown. */
  const onMessage = (value: unknown): void => received.resolve(value)
  ports.port2.once('message', onMessage)
  /** A real cold source lends its actual current context without creating a Peer or fake brand. */
  const host = await createRpcHost({
    self: { name: 'custody', instanceId: 'custody' },
    plugins: [
      defineTransportPlugin({
        name: 'custody-physical-composition',
        namespace: 'process',
        features: { queue: sendQueueFeature() },
        /** Only native setup lends this source its existing transport authority and signal. */
        open(context) {
          /** Both original component receipts stay with this source's normal disposer. */
          const resources = openCustodyCarrier(context, raw)
          acquired.resolve(resources)
          return { dispose: resources.dispose }
        }
      })
    ]
  })
  try {
    /** Both values came from the supported factories under the one genuine native source. */
    const { carrier, installed } = await acquired.promise
    /** The original physical frame is opaque to native queue admission and remains unchanged. */
    const frame: IRpcCarrierFrame = { kind: 'message', data: 'fast' }
    /** Only writeProcessMessage invokes this unchanged callback at the actual native handoff. */
    const onWriteStart = (): void => {
      order.push('started')
    }
    await installed.value.run(
      { sendClass: IpcSendClass.data },
      () => carrier.write(frame, { onWriteStart }),
      {
        assertCanSend() {
          order.push('admission')
        }
      }
    )
    expect(order.at(-1)).toBe('write')
    expect(order.slice(-3)).toEqual(['admission', 'started', 'write'])
    expect(order.filter((event) => event === 'started')).toHaveLength(1)
    expect(order.filter((event) => event === 'write')).toHaveLength(1)
    expect(await received.promise).toEqual(frame)
  } finally {
    await host.close()
    ports.port2.off('message', onMessage)
    ports.port1.close()
    ports.port2.close()
  }
})
