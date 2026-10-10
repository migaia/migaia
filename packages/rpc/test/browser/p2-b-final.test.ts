import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { createFullOneWayEndpoint, connect } from '../../src/core/index.js'
import { createWebWorkerTransport } from '../../src/browser/adapters/web-worker.js'
import { envelope } from '../core/fixtures/p2-b-envelope.js'

describe('P2-B optimal physical writer', () => {
  it('[A28] one bad member cannot block valid siblings or serialize provider execution', async () => {
    /** Both canonical factories belong to the same explicit static deployment. */
    const listeners = [
      new Set<(event: MessageEvent) => void>(),
      new Set<(event: MessageEvent) => void>()
    ]
    /** Physical frames and delivery are visible without replacing the core receiver. */
    const ports = [0, 1].map((side) => ({
      postMessage(value: unknown) {
        queueMicrotask(() => {
          for (const listener of listeners[1 - side]!) listener({ data: value } as MessageEvent)
        })
      },
      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === 'message') listeners[side]!.add(listener)
      },
      removeEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (type === 'message') listeners[side]!.delete(listener)
      }
    }))
    /** The actual canonical transport grants source/identity behavior on each endpoint. */
    const transport = createWebWorkerTransport(ports[1] as never, { peerId: 'a' })
    /** Provider work is held to distinguish admission order from completion order. */
    const endpoint = await createFullOneWayEndpoint({
      id: 'b',
      transport,
      middlewares: [connect({ transport })]
    })
    /** Concurrent entries must be observable before either provider completes. */
    const seen: string[] = []
    /** One business hold is released only after both semantic admissions are checked. */
    let release!: () => void
    /** Ordinary asynchronous provider execution uses the existing provider owner. */
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    endpoint.provide('echo', async (context) => {
      seen.push(context.data as string)
      await held
      return context.success(context.data)
    })
    try {
      ports[0]!.postMessage({
        kind: 'batch',
        envelopes: [envelope('good-one'), { kind: 'request', id: 'bad' }, envelope('good-two')]
      })
      await new Promise<void>((resolve) => setTimeout(resolve, 10))
      assert.deepEqual(
        seen,
        ['good-one', 'good-two'],
        '[A28] valid siblings enter before either provider completes'
      )
    } finally {
      release()
      await endpoint.dispose()
    }
  })
})
