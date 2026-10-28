import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { batchFeature, retryFeature } from '@migaia/log-host/features'
import { httpPlugin } from '../../src/index.ts'

/** Final buffered entries are delivered before the transport's registration is revoked. */
async function finalBufferedEntry(): Promise<void> {
  /** Only the supported fetcher boundary records requests; no fake controller seam is installed. */
  const bodies: string[] = []
  /** Signal state is observed at actual POST admission, before any shutdown cleanup. */
  const aborted: Array<boolean | undefined> = []
  /** The output keeps the old ordinary batch default while policy belongs to the host. */
  const host = createLogHost({
    plugins: [
      httpPlugin({
        url: 'memory-only',
        features: [batchFeature()],
        fetcher: async (_url, init) => {
          bodies.push(init.body)
          aborted.push(init.signal?.aborted)
          return new Response(null, { status: 200 })
        }
      })
    ]
  })
  host.log('info', 'final entry')
  await host.shutdown('manual')
  expect(bodies).toHaveLength(1)
  expect(JSON.parse(bodies[0]).entries[0].message).toBe('final entry')
  expect(aborted).toEqual([false])
}
it('drains buffered HTTP logs before aborting the transport owner', finalBufferedEntry)

/** Structured final work is admitted while shutdown handlers run and before output revocation. */
async function handlerFinalEntry(): Promise<void> {
  /** The real fetcher is the only transport observation seam. */
  const bodies: string[] = []
  /** Exact calls and active-signal state remain public behavior assertions. */
  const fetcher = vi.fn(async (_url: string, init: { body: string; signal?: AbortSignal }) => {
    expect(init.signal?.aborted).toBe(false)
    bodies.push(init.body)
    return new Response(null, { status: 200 })
  })
  /** No private controller factory is added to replace the removed global runtime option. */
  const host = createLogHost({ plugins: [httpPlugin({ url: 'memory-only', fetcher })] })
  host.onShutdown(() => {
    host.log('info', 'late-shutdown-entry')
  })
  await expect(host.shutdown('manual')).resolves.toMatchObject({
    logicalTerminal: true,
    cleanupComplete: true
  })
  expect(fetcher).toHaveBeenCalledOnce()
  expect(JSON.parse(bodies[0]).entries[0].message).toBe('late-shutdown-entry')
  await expect(host.flush()).resolves.toBeUndefined()
}
it(
  'drains final entries before disposal abort through the public request signal',
  handlerFinalEntry
)

/** Retry classification preserves both raw network rejection and retryable server status. */
async function retryFailure(name: 'HTTP 5xx' | 'network failure'): Promise<void> {
  /** Each branch succeeds on its second actual POST. */
  const fetch = vi.fn<() => Promise<Response>>()
  if (name === 'HTTP 5xx') fetch.mockResolvedValueOnce(new Response(null, { status: 503 }))
  else fetch.mockRejectedValueOnce(new Error('offline'))
  fetch.mockResolvedValueOnce(new Response(null, { status: 200 }))
  /** Zero configured backoff isolates retry classification from separately preserved delay tests. */
  const logger = createLogHost({
    plugins: [
      httpPlugin({
        url: 'https://example.test/logs',
        fetcher: fetch,
        features: [retryFeature({ attempts: 2, backoff: 0 })]
      })
    ]
  })
  logger.log('info', 'message')
  await logger.flush()
  expect(fetch).toHaveBeenCalledTimes(2)
  await logger.shutdown('manual')
}
it.each(['HTTP 5xx', 'network failure'] as const)('retries %s failures', retryFailure)
