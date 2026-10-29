import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { batchFeature, retryFeature } from '@migaia/log-host/features'
import { createManualScheduler } from '@migaia/utils/testing'
import { httpPlugin } from '../src/index.ts'

/** One in-memory fetcher returns a retryable response before accepting the same batch. */
class MemoryTransport {
  /** Every serialized POST body is retained as an independent wire observation. */
  readonly bodies: string[] = []
  /** Every request records its scheduler time rather than wall-clock timing. */
  readonly times: number[] = []
  /** The manual clock makes Retry-After timing deterministic. */
  #now: () => number
  /** Borrow one deterministic clock without changing transport behavior. */
  constructor(now: () => number) {
    this.#now = now
  }
  /** The callback shape is the public injectable fetch contract. */
  readonly fetch = (_url: string, init: { body: string }): Promise<Response> => this.send(init.body)
  /** Record one POST attempt and provide actual Fetch response/header behavior. */
  async send(body: string): Promise<Response> {
    this.bodies.push(body)
    this.times.push(this.#now())
    return new Response(null, {
      status: this.bodies.length === 1 ? 503 : 200,
      headers: { 'Retry-After': '1' }
    })
  }
}

/** A two-entry batch retains its envelope and order on a server-advised retry. */
async function batchRetry(): Promise<void> {
  /** One explicit scheduler owns both host and retry policy time. */
  const scheduler = createManualScheduler()
  /** The fetcher remains entirely in memory. */
  const transport = new MemoryTransport(() => scheduler.now())
  /** Policy belongs to the host, leaving the HTTP plugin responsible for one POST attempt. */
  const host = createLogHost({
    scheduler,
    plugins: [
      httpPlugin({
        url: 'memory-only',
        fetcher: transport.fetch,
        features: { batch: batchFeature({ maxSize: 2 }), retry: retryFeature({ attempts: 2 }) }
      })
    ]
  })
  host.log('info', 'one')
  host.log('info', 'two')
  // Sixty-four microtasks are a fixed fixture bound for entering the first retry wait.
  for (let index = 0; index < 64; index++) await Promise.resolve()
  expect(transport.bodies).toHaveLength(1)
  scheduler.advance(999)
  await Promise.resolve()
  expect(transport.bodies).toHaveLength(1)
  scheduler.advance(1)
  await host.flush()
  expect(transport.bodies).toHaveLength(2)
  for (const body of transport.bodies) {
    /** Envelope shape and message order are asserted separately on both attempts. */
    const payload = JSON.parse(body)
    expect(Object.keys(payload)).toEqual(['entries'])
    expect(payload.entries.map(message)).toEqual(['one', 'two'])
  }
  expect(transport.times[1] - transport.times[0]).toBeGreaterThanOrEqual(1000)
  await host.shutdown('manual')
}

/** Extract a message without depending on serialization metadata. */
function message(entry: { message: string }): string {
  return entry.message
}
it('posts an ordered entries envelope and honors Retry-After through host policy', batchRetry)

/** Invalid Retry-After bounds are rejected before installation side effects. */
function invalidRetryBound(): void {
  for (const maxRetryAfterMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() => httpPlugin({ url: 'memory-only', maxRetryAfterMs })).toThrow(
      expect.objectContaining({ source: 'logging.http', code: 'INVALID_OPTION' })
    )
  }
}
it('rejects nonfinite or negative Retry-After bounds at construction', invalidRetryBound)
