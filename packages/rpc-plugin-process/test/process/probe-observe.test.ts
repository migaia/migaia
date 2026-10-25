import { PassThrough } from 'node:stream'
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, type IRpcTransportSetupContext } from '@migaia/rpc-host/sdk'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
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
