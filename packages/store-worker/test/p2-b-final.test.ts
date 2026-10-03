import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { WorkerAdapter, createWorkerHandler } from '../src/index.js'
import { createWorkerContractEndpoint } from '../src/worker-contract.js'

/** Worker-like linked ports expose actual physical frames while retaining the canonical factories. */
function linked() {
  const listeners = [
    new Set<(event: MessageEvent) => void>(),
    new Set<(event: MessageEvent) => void>()
  ]
  const frames: unknown[][] = [[], []]
  const ports = [0, 1].map((side) => ({
    postMessage(value: unknown) {
      frames[side]!.push(value)
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
  return { ports, frames }
}

describe('store-worker existing APIs consume core batching', () => {
  it('[A25] concurrent request results remain independent and real frames include automatic batches', async () => {
    const { ports, frames } = linked()
    const handler = createWorkerHandler(
      (value: unknown) => `result:${String(value)}`,
      (value) => ports[1]!.postMessage(value)
    )
    /**
     * The existing handler entry consumes frames rather than adding a worker-specific batching
     * owner.
     */
    ports[0]!.postMessage = (value) => {
      frames[0]!.push(value)
      void handler(value)
    }
    const adapter = new WorkerAdapter(ports[0] as never)
    try {
      const inputs = Array.from({ length: 16 }, (_, index) => String(index))
      assert.deepEqual(
        await Promise.all(inputs.map((value) => adapter.request(value))),
        inputs.map((value) => `result:${value}`)
      )
      assert.ok(
        frames.flat().some((value) => (value as { kind: string }).kind === 'batch'),
        '[A25] actual store-worker consumer uses the core physical grouping'
      )
    } finally {
      await adapter.dispose()
      await handler.dispose()
    }
  })
  it('[A25] existing notify settles after physical emission and request waits for computation', async () => {
    const { ports } = linked()
    const client = await createWorkerContractEndpoint(ports[0] as never)
    const server = await createWorkerContractEndpoint(ports[1] as never, {
      id: 'worker',
      targetId: 'main'
    })
    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    let entered = 0
    server.onRequest('notify', async () => {
      entered++
      await held
    })
    server.onRequest('call', async (value) => {
      entered++
      await held
      return value
    })
    try {
      await client.notify('sent')
      assert.equal(entered, 1, '[A25] notify does not wait for the held remote computation')
      let settled = false
      const requested = client.request('computed').then((value) => {
        settled = true
        return value
      })
      for (let index = 0; index < 30 && entered < 2; index++) await Promise.resolve()
      assert.equal(settled, false, '[A25] request retains remote completion semantics')
      release()
      assert.equal(await requested, 'computed')
    } finally {
      release()
      await client.close()
      await server.close()
    }
  })
})
