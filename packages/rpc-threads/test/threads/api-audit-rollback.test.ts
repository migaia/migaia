import { MessageChannel } from 'node:worker_threads'
import { expect, it } from 'vitest'
import { createWebThreadLauncher } from '../../src/threads/index.js'

it('[RT-D02] rolls back the actual acquired Worker when its first physical write fails', async () => {
  /** The native I/O failure must remain the same primary exception after rollback. */
  const original = new Error('audit initial Worker write failed')
  /** The public constructor publishes each actual acquired resource for final leak cleanup. */
  const workers: OwnedWorker[] = []
  /** This complete injected Worker owns native ports and normal EventTarget subscriptions. */
  class OwnedWorker {
    /** Both physical ports belong to this Worker and are released only by terminate. */
    readonly ports = new MessageChannel()
    /** Native close observation proves the physical resource was released, not only invoked. */
    readonly closed = new Promise<void>((resolve) => this.ports.port1.once('close', resolve))
    /** Native event registration remains observable without replacing launcher internals. */
    readonly events = new EventTarget()
    /** Held callbacks prove that construction rollback removed both launcher subscriptions. */
    readonly listeners = new Map<string, Set<EventListener>>()
    /** Termination must occur before the test performs manual final cleanup. */
    terminated = 0
    /** Publish the real object created by the launcher's public constructor boundary. */
    constructor() {
      workers.push(this)
    }
    /** The first actual outbound operation fails after listener/resource acquisition. */
    postMessage(): void {
      throw original
    }
    /** Delegate public subscriptions to native EventTarget and retain their exact identities. */
    addEventListener(type: string, listener: EventListener): void {
      this.events.addEventListener(type, listener)
      if (!this.listeners.has(type)) this.listeners.set(type, new Set())
      this.listeners.get(type)!.add(listener)
    }
    /** Remove the same native callback and its observation entry. */
    removeEventListener(type: string, listener: EventListener): void {
      this.events.removeEventListener(type, listener)
      this.listeners.get(type)?.delete(listener)
    }
    /** This operation, rather than an assertion counter alone, releases real native ports. */
    terminate(): void {
      this.terminated++
      this.ports.port1.close()
      this.ports.port2.close()
    }
  }
  /** Only public launcher injection supplies this complete Worker constructor. */
  const launcher = createWebThreadLauncher({ Worker: OwnedWorker, report: () => undefined })
  try {
    await expect(
      launcher.launch(
        { entry: new URL(import.meta.url).href },
        {
          signal: new AbortController().signal
        }
      )
    ).rejects.toBe(original)
    expect(original).toMatchObject({ source: '@migaia/rpc/core', code: 'TRANSPORT' })
    expect(workers[0]!.terminated).toBe(1)
    await workers[0]!.closed
    expect([...workers[0]!.listeners.values()].every((group) => group.size === 0)).toBe(true)
  } finally {
    for (const worker of workers) if (!worker.terminated) worker.terminate()
    await Promise.all(workers.map((worker) => worker.closed))
  }
})
