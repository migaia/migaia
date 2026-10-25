import { MessageChannel } from 'node:worker_threads'
import { describe, expect, it } from 'vitest'
import { createWebThreadCarrier, createNodeThreadCarrier } from '../../dist/threads/channel.js'
import { createWebThreadLauncher } from '../../dist/threads/web-launcher.js'

/** Confirms tagging preserves the native error and its stable public text. */
function expectTransportIdentity(value: unknown, message: string): void {
  const error = value as Error & { source?: string; code?: string }
  expect(error.constructor).toBe(Error)
  expect(error.name).toBe('Error')
  expect(error.message).toBe(message)
  expect(typeof error.stack).toBe('string')
  expect(error.stack?.length).toBeGreaterThan(0)
  expect(Object.hasOwn(error, 'source')).toBe(true)
  expect(Object.hasOwn(error, 'code')).toBe(true)
  expect(error.source).toBe('rpc.endpoint')
  expect(error.code).toBe('TRANSPORT')
}

describe('control message-port transport error identity', () => {
  it('tags browser message errors without changing the native error', async () => {
    /** The structural browser port exposes its registered event callbacks. */
    const listeners = new Map<string, (event: unknown) => void>()
    const port = {
      postMessage() {},
      start() {},
      close() {},
      addEventListener(type: string, listener: (event: unknown) => void) {
        listeners.set(type, listener)
      },
      removeEventListener(type: string) {
        listeners.delete(type)
      }
    }
    /** The actual Thread IO owns the native diagnostic hook separately from its frame reader. */
    const errors: unknown[] = []
    const carrier = createWebThreadCarrier(port, 'browser-native-error', (error) =>
      errors.push(error)
    )
    try {
      listeners.get('messageerror')?.({})
      expect(errors).toHaveLength(1)
      expectTransportIdentity(
        errors[0],
        '[rpc] browser message port could not deserialize a message'
      )
    } finally {
      await carrier.close()
    }
  })

  it('tags Node message and close errors while replaying the same terminal object', async () => {
    /** A real Node MessagePort supplies its EventEmitter error and close events. */
    const channel = new MessageChannel()
    try {
      const errors: unknown[] = []
      const carrier = createNodeThreadCarrier(channel.port1, 'node-native-error', (error) =>
        errors.push(error)
      )
      carrier.subscribe({ frame() {}, error() {}, close: (error) => errors.push(error) })
      channel.port1.emit('messageerror', 'x')
      channel.port1.emit('close', undefined)
      expect(errors).toHaveLength(2)
      expectTransportIdentity(errors[0], '[rpc] message port could not deserialize a message: x')
      expectTransportIdentity(errors[1], '[rpc] message port closed')
      const replayed: unknown[] = []
      carrier.subscribe({ frame() {}, error() {}, close: (error) => replayed.push(error) })
      expect(replayed).toHaveLength(1)
      expect(replayed[0]).toBe(errors[1])
      await carrier.close()
    } finally {
      channel.port1.close()
      channel.port2.close()
    }
  })
})

// RPC-TEST-00776736DCA7-C005: preserve the original Worker error event, report count and native cause.
it('retains the original Worker ErrorEvent cause through the actual native Web launcher', async () => {
  /** The actual native cause must survive independently of the event's presentation message. */
  const original = new Error('audit worker cause')
  /** The existing launcher rollback fixture publishes each actual acquired native resource. */
  const workers: OwnedErrorWorker[] = []
  /**
   * Same public constructor injection as api-audit-rollback, with real native event and port
   * owners.
   */
  class OwnedErrorWorker extends EventTarget {
    /** Real postMessage owns bootstrap cloning; no send failure or expected diagnostic is supplied. */
    readonly ports = new MessageChannel()
    /** Actual native resource release, rather than a fabricated Worker exit, completes this receipt. */
    readonly closed = new Promise<void>((resolve) => this.ports.port1.once('close', resolve))

    /** Only the production launcher constructs and publishes the Worker used by this event. */
    constructor() {
      super()
      workers.push(this)
    }

    /** Forward the launcher's real bootstrap into its original physical native port. */
    postMessage(value: unknown): void {
      this.ports.port1.postMessage(value)
    }

    /** Original Worker termination releases real ports without inventing an exit guarantee. */
    terminate(): void {
      this.ports.port1.close()
      this.ports.port2.close()
    }
  }
  /** Only the actual native Worker error owner may produce a diagnostic from this event. */
  const observed: unknown[] = []
  /** The production launcher installs WebThreadGeneration's actual error and carrier lifetimes. */
  const launcher = createWebThreadLauncher({
    Worker: OwnedErrorWorker,
    report: (error) => {
      observed.push(error)
    }
  })
  /** Node's real Event carries the original supported ErrorEvent error and message fields. */
  const event = new Event('error')
  Object.defineProperties(event, {
    error: { value: original },
    message: { value: original.message }
  })
  try {
    /** Use the same original native launch context accepted by the existing rollback receiver. */
    const handle = await launcher.launch(
      { entry: new URL(import.meta.url).href },
      { signal: new AbortController().signal }
    )
    /** This EventTarget is the exact Worker acquired by the actual production generation owner. */
    workers[0]!.dispatchEvent(event)
    expect.soft(observed).toHaveLength(1)
    expect.soft(observed[0]).toMatchObject({
      source: 'rpc.endpoint',
      code: 'TRANSPORT',
      cause: original
    })
    expect((observed[0] as Error | undefined)?.cause).toBe(original)
    handle.terminate()
  } finally {
    for (const worker of workers) worker.terminate()
    await Promise.all(workers.map((worker) => worker.closed))
  }
})
