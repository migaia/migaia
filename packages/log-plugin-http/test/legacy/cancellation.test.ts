import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { timeoutFeature } from '@migaia/log-host/features'
import { httpPlugin } from '../../src/index.ts'

/** A real injectable fetcher cooperatively rejects when its actual request signal aborts. */
class AbortTransport {
  /** Request count proves shutdown does not issue another POST. */
  calls = 0
  /** Cooperative cancellation count is independent of host timeout diagnostics. */
  aborts = 0
  /** The exact request signal is observable through the supported fetcher interface. */
  signal: AbortSignal | undefined
  /** Promise rejection belongs to the one active request. */
  #reject: ((reason: unknown) => void) | undefined
  /** The fetch callback preserves a standalone capability shape. */
  readonly fetch = (_url: string, init: { signal?: AbortSignal }): Promise<Response> =>
    this.send(init.signal)
  /** One stable native listener is removed when cooperative cancellation settles the request. */
  readonly #abort = (): void => this.abort()
  /** Start only one controlled request without installing another controller seam. */
  send(signal: AbortSignal | undefined): Promise<Response> {
    this.calls++
    this.signal = signal
    return new Promise<Response>((_resolve, reject) => this.arm(reject))
  }
  /** Register the fixture's own cooperative listener on the real supplied signal. */
  arm(reject: (reason: unknown) => void): void {
    this.#reject = reject
    this.signal!.addEventListener('abort', this.#abort, { once: true })
    if (this.signal!.aborted) this.abort()
  }
  /** Preserve the native abort error while removing only this fetcher's own registration. */
  abort(): void {
    this.aborts++
    this.signal!.removeEventListener('abort', this.#abort)
    this.#reject?.(new DOMException('request aborted', 'AbortError'))
  }
}

/** The default shutdown budget aborts a hanging request after draining, without duplicate POSTs. */
async function shutdownAbort(): Promise<void> {
  vi.useFakeTimers()
  /** The transport is fully cooperative and never touches a network socket. */
  const transport = new AbortTransport()
  /** Timeout policy is explicit and longer than the host's three-second shutdown budget. */
  const host = createLogHost({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
    report: ignore,
    plugins: [
      httpPlugin({
        url: 'memory-only',
        fetcher: transport.fetch,
        features: [timeoutFeature({ ms: 10000 })]
      })
    ]
  })
  try {
    host.log('info', 'pending request')
    await microtasks()
    expect(transport.calls).toBe(1)
    expect(transport.signal?.aborted).toBe(false)
    /** The public terminal Promise is published before the bounded drain begins. */
    const shutdown = host.shutdown('manual')
    await microtasks()
    await vi.advanceTimersByTimeAsync(3000)
    await expect(shutdown).resolves.toMatchObject({ logicalTerminal: true })
    expect(transport.signal?.aborted).toBe(true)
    expect(transport.aborts).toBe(1)
    expect(transport.calls).toBe(1)
  } finally {
    vi.useRealTimers()
  }
}

/** Expected lifecycle degradation is deliberately captured instead of writing the fixture stderr. */
function ignore(): void {}
/** Fixed queue progress adapts the previous immediate dispatch to the approved asynchronous path. */
async function microtasks(): Promise<void> {
  for (let index = 0; index < 64; index++) await Promise.resolve()
}
it('aborts an in-flight HTTP request during shutdown', shutdownAbort)
