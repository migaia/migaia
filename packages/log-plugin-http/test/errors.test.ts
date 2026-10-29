import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { retryFeature } from '@migaia/log-host/features'
import { httpPlugin } from '../src/index.ts'

/** Transport rejection retains its original Error instance on the HTTP wrapper's cause. */
async function networkFailure(): Promise<void> {
  /** The exact native failure must remain reachable after package ownership changes. */
  const original = new TypeError('network failure')
  /** A single final report proves there is no hidden HTTP retry loop. */
  const failures: unknown[] = []
  /** No network call leaves the process. */
  const fetcher = vi.fn(async () => {
    throw original
  })
  /** One ordinary output attempt owns this failure. */
  const host = createLogHost({ plugins: [httpPlugin({ url: 'memory-only', fetcher })] })
  host.onFailure((failure) => {
    failures.push(failure.error)
  })
  expect(() => host.log('info', 'failure')).not.toThrow()
  await host.flush()
  expect(fetcher).toHaveBeenCalledOnce()
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({
    source: 'logging.http',
    code: 'DELIVERY_FAILED',
    cause: original
  })
  expect((failures[0] as Error).cause).toBe(original)
  await host.shutdown('manual')
}
it('DELIVERY_FAILED wraps one transport error with original cause and one failure', networkFailure)

/** An existing HTTP-coded native error is retained rather than replaced on final failure. */
async function existingDeliveryIdentity(): Promise<void> {
  /** Native type, stack and identity already belong to the injected HTTP transport. */
  const original = Object.assign(new RangeError('existing delivery'), {
    source: 'logging.http',
    code: 'DELIVERY_FAILED'
  })
  /** Host retries are explicit and bounded independently of HTTP. */
  const fetcher = vi.fn(async () => {
    throw original
  })
  /** Final failure is observed exactly once after the configured attempts. */
  const failures: unknown[] = []
  /** A zero backoff keeps the identity case independent from timer behavior. */
  const host = createLogHost({
    plugins: [
      httpPlugin({
        url: 'memory-only',
        fetcher,
        features: { retry: retryFeature({ attempts: 2, backoff: 0 }) }
      })
    ]
  })
  host.onFailure((failure) => {
    failures.push(failure.error)
  })
  host.log('info', 'failure')
  await host.flush()
  expect(fetcher).toHaveBeenCalledTimes(2)
  expect(failures).toEqual([original])
  expect(failures[0]).toBeInstanceOf(RangeError)
  await host.shutdown('manual')
}
it(
  'preserves an already tagged native HTTP delivery error after host retries',
  existingDeliveryIdentity
)

/** A nonretryable client response is sent once despite an enabled retry feature. */
async function clientFailure(): Promise<void> {
  /** The fetcher exposes call count independently of host policy internals. */
  const fetcher = vi.fn(async () => new Response(null, { status: 400 }))
  /** The final coded response remains visible to the business failure channel. */
  const failures: unknown[] = []
  /** A retry descriptor cannot change the transport's nonretryable classification. */
  const host = createLogHost({
    plugins: [
      httpPlugin({
        url: 'memory-only',
        fetcher,
        features: { retry: retryFeature({ attempts: 3, backoff: 0 }) }
      })
    ]
  })
  host.onFailure((failure) => {
    failures.push(failure.error)
  })
  host.log('info', 'bad request')
  await host.flush()
  expect(fetcher).toHaveBeenCalledOnce()
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({
    source: 'logging.http',
    code: 'DELIVERY_FAILED',
    message: '日志推送失败: HTTP 400'
  })
  await host.shutdown('manual')
}
it('does not retry HTTP 400 responses and reports the send failure', clientFailure)

/** Missing transport is rejected by the factory before the host can install any resources. */
function unavailableTransport(): void {
  vi.stubGlobal('fetch', undefined)
  try {
    expect(() => httpPlugin({ url: 'memory-only' })).toThrow(
      expect.objectContaining({ source: 'logging.http', code: 'TRANSPORT_UNAVAILABLE' })
    )
  } finally {
    vi.unstubAllGlobals()
  }
}
it(
  'rejects a missing injected and native fetch capability during construction',
  unavailableTransport
)

/** The retained serialization boundary classifies failure before any POST attempt. */
async function serializationFailure(): Promise<void> {
  /** A caller-owned cycle deterministically makes the wire projection unserializable. */
  const circular: { self?: unknown } = {}
  circular.self = circular
  /** No transport call may happen after serialization fails. */
  const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
  /** The original serializer TypeError must remain on the HTTP failure cause. */
  const failures: unknown[] = []
  /** Default HTTP JSON output exercises the real default creation path. */
  const host = createLogHost({ plugins: [httpPlugin({ url: 'memory-only', fetcher })] })
  host.onFailure((failure) => {
    failures.push(failure.error)
  })
  host.log('info', 'circular', circular)
  await host.flush()
  expect(fetcher).not.toHaveBeenCalled()
  expect(failures).toHaveLength(1)
  expect(failures[0]).toMatchObject({ source: 'logging.http', code: 'SERIALIZE_FAILED' })
  expect((failures[0] as Error).cause).toBeInstanceOf(TypeError)
  await host.shutdown('manual')
}
it('SERIALIZE_FAILED preserves the JSON serialization cause before transport', serializationFailure)
