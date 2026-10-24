import { EventEmitter } from 'node:events'
import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it, vi } from 'vitest'
import { systemScheduler } from '@migaia/utils/scheduler'
import type { IRpcCarrierProbe } from '@migaia/rpc-host/probe'
import type { IRuntimePeerSourceResult } from '@migaia/rpc-host/plugin'
import { createNodeThreadChannel, createWebThreadChannel } from '../../dist/threads/channel.js'
import { AdapterNodeThreadParentChannel } from '../../dist/threads/node-parent.js'
import { createAdapterWebThreadChannelFactory as createWebThreadChannelFactory } from '../../dist/threads/web-launcher.js'
import { createNodeThreadChannelFactory } from '../../src/threads/adapters/node.js'

import type { IThreadWebPort } from '../../src/threads/types.js'

/** Structural Node I/O exercises each exported channel's actual borrowed-port branch. */
function nodePort() {
  /** The held port exposes physical messaging and native hook ownership without a runtime launcher. */
  const port = Object.assign(new EventEmitter(), {
    postMessage(message: unknown, transfer?: readonly unknown[]) {
      /**
       * Native clone output preserves physical postMessage delivery and transfer detachment in the
       * fixture.
       */
      const data = structuredClone(message, { transfer: transfer as Transferable[] | undefined })
      queueMicrotask(() => port.emit('message', data))
    }
  })
  return port
}
/** EventTarget ports preserve native transfer detachment without relying on a platform runtime. */
/** Allocate only this case's original observations before installing native-shaped callbacks. */
function webPortFixtureState() {
  const events = new EventTarget()
  return { events }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class WebPortFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof webPortFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value: IThreadWebPort
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor() {
    this.#state = webPortFixtureState()

    this.value = {
      postMessage: (message, transfer) => {
        /**
         * Native clone output preserves physical postMessage delivery and transfer detachment in
         * the fixture.
         */
        const data = structuredClone(message, { transfer: transfer as Transferable[] | undefined })
        queueMicrotask(() =>
          this.#state.events.dispatchEvent(new MessageEvent('message', { data }))
        )
      },
      addEventListener: (type, listener) => this.#state.events.addEventListener(type, listener),
      removeEventListener: (type, listener) =>
        this.#state.events.removeEventListener(type, listener)
    }
  }
}

/** Create one independent owner for the existing native-boundary fixture. */
function webPort(): IThreadWebPort {
  return new WebPortFixture().value
}

/** A custom handle supplies only the public raw-port shape; it cannot counterfeit Core preparation. */
function handle<T>(port: T) {
  return {
    port,
    identity: { fingerprint: 'probe-fixture' },
    exited: new Promise<never>(() => undefined),
    terminate() {},
    prepared: Promise.resolve()
  }
}
/** Exact public factory operations must retain observation on their final Core-owned transport. */
const cases: readonly [
  string,
  () => IRuntimePeerSourceResult | Promise<IRuntimePeerSourceResult>
][] = [
  [
    'node channel',
    () => createNodeThreadChannel(nodePort(), 'peer', { scheduler: systemScheduler })
  ],
  ['web channel', () => createWebThreadChannel(webPort(), 'peer', { scheduler: systemScheduler })],
  [
    'parent channel',
    () =>
      new AdapterNodeThreadParentChannel(nodePort()).open('peer', { scheduler: systemScheduler })
  ],
  [
    'node factory',
    () =>
      createNodeThreadChannelFactory({ scheduler: systemScheduler }).open(
        handle(nodePort()),
        new AbortController().signal
      )
  ],
  [
    'web factory',
    () =>
      createWebThreadChannelFactory({ scheduler: systemScheduler }).open(
        handle(webPort()),
        new AbortController().signal
      )
  ]
]

describe('Thread channels inherit canonical physical observation', () => {
  it.each(cases)(
    '%s retains capture, error isolation, replacement and close',
    async (_name, open) => {
      /**
       * Retain the public channel lifetime while testing its final transport observation
       * capability.
       */
      const channel = await open()
      /** Exercise the final carrier boundary so observation assertions cover actual native I/O. */
      const transport = channel.transport
      /** Retain synchronous probe output while captured content keeps its original identity. */
      const events: { direction: number; size: number; detail: unknown; content: unknown }[] = []
      /**
       * Install the direct carrier contract so assertions do not depend on probe-core
       * instrumentation.
       */
      const probe: IRpcCarrierProbe = {
        capturing: true,
        emit(direction, size, _carrier, detail, content) {
          events.push({ direction, size, detail: detail && { ...detail }, content })
        }
      }
      /** An older disposer must not retire the replacement observation generation. */
      const stale = transport.observe!(probe)
      /**
       * This current-generation handle must retire observation idempotently without removing
       * another generation.
       */
      const dispose = transport.observe!(probe)
      stale()
      stale()
      /**
       * Count business message delivery independently of observation callbacks and reporting
       * failures.
       */
      const receive = vi.fn()
      /**
       * Release the existing message or diagnostic registration without claiming physical port
       * closure.
       */
      const remove = transport.subscribe(receive)
      /** Native byte payload proves transfer detachment and captured byte preservation together. */
      const bytes = new Uint8Array([4, 6, 8])
      transport.send(bytes, { transfer: [bytes.buffer] })
      expect(bytes.byteLength).toBe(0)
      await Promise.resolve()
      expect(events.map((event) => [event.direction, event.size, event.detail])).toEqual([
        [0, 3, { transfers: 1 }],
        [1, 3, { transfers: -1 }]
      ])
      expect(Array.from(events[0]!.content as Uint8Array)).toEqual([4, 6, 8])
      expect(receive).toHaveBeenCalledTimes(1)
      dispose()
      dispose()
      transport.send(8)
      await Promise.resolve()
      expect(events).toHaveLength(2)
      /**
       * Original failure identity must remain reachable through reporting without failing message
       * delivery.
       */
      const cause = new TypeError('thread probe failure')
      /** Record failure delivery so reporting count and original error identity can be asserted. */
      const errors = vi.fn()
      /** Release this diagnostic registration after its reporting or retirement assertions finish. */
      const removeError = transport.onListenerError!(errors)
      transport.observe!({
        capturing: false,
        emit() {
          throw cause
        }
      })
      transport.send(9)
      await Promise.resolve()
      expect(receive).toHaveBeenCalledTimes(3)
      expect(errors).toHaveBeenCalledTimes(2)
      for (const [error] of errors.mock.calls)
        expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT', cause })
      transport.observe!(probe)
      remove()
      removeError()
      await channel.close?.()
      transport.observe!(probe)
      /** Logical close must retire observation without claiming that a borrowed native port closed. */
      try {
        transport.send(7)
      } catch (error) {
        /** Owned adapter retirement retains its existing TRANSPORT send rejection path. */
        expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'TRANSPORT' })
      }
      await Promise.resolve()
      expect(events).toHaveLength(2)
    }
  )
  it('real Node worker port transfers through the final exported channel', async () => {
    /** A real MessageChannel proves the adapter preserves native ArrayBuffer transfer detachment. */
    const ports = new MessageChannel()
    /**
     * The sending channel supplies the final public transport used by the native transfer
     * assertion.
     */
    const left = createNodeThreadChannel(ports.port1, 'right', { scheduler: systemScheduler })
    /** The receiving channel proves physical delivery through the final public transport. */
    const right = createNodeThreadChannel(ports.port2, 'left', { scheduler: systemScheduler })
    /** Retain synchronous probe output while captured content keeps its original identity. */
    const events: unknown[] = []
    left.transport.observe!({
      capturing: true,
      emit(_direction, _size, _carrier, _detail, content) {
        events.push(content)
      }
    })
    /**
     * Resolve only from the actual native receiver so preserved capture bytes cannot stand in for
     * delivery.
     */
    const received = new Promise<unknown>((resolve) =>
      right.transport.subscribe((message) => resolve(message.data))
    )
    try {
      /** The transferred backing must detach natively while captured bytes remain readable. */
      const buffer = new Uint8Array([7, 9]).buffer
      left.transport.send(buffer, { transfer: [buffer] })
      expect(buffer.byteLength).toBe(0)
      expect(Array.from(new Uint8Array(events[0] as ArrayBuffer))).toEqual([7, 9])
      expect(Array.from(new Uint8Array((await received) as ArrayBuffer))).toEqual([7, 9])
    } finally {
      await left.close?.()
      await right.close?.()
      ports.port1.close()
      ports.port2.close()
    }
  })
})
