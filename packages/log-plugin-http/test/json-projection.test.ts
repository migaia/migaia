import { defineLogPlugin } from '@migaia/log-host/plugin'
import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { serializeErrorChain } from '@migaia/utils/error'
import { formatFeature } from '@migaia/log-host/features'
import { defineLogFeature } from '@migaia/log-host/plugin'
import { httpPlugin } from '../src/index.ts'

/**
 * Every raw/cause/aggregate branch has a different private field that must stay off structured
 * wire.
 */
async function jsonProjection(): Promise<void> {
  /** Cause identity and stack must survive without serializing its enumerable private fields. */
  const cause = Object.assign(new TypeError('cause'), {
    source: 'upstream.domain',
    code: 'CAUSE',
    privateCause: 'http-cause-private'
  })
  /** Aggregate branches are independent from the cause chain and need their own projection. */
  const secondary = Object.assign(new RangeError('secondary'), {
    source: 'upstream.domain',
    code: 'SECONDARY',
    privateSecondary: 'http-secondary-private'
  })
  /** The original aggregate carries a third private sentinel and the original cause object. */
  const raw = Object.assign(new AggregateError([secondary], 'top', { cause }), {
    source: 'upstream.domain',
    code: 'TOP',
    privateTop: 'http-top-private'
  })
  /** An ordinary payload remains native and is never modified by error projection. */
  const object = { business: true }
  /** The input argument container remains caller-owned after dispatch. */
  const args = [object]
  /** Native error info is supplied separately from args to isolate the documented error projection. */
  const error = { name: raw.name, message: raw.message, stack: raw.stack, raw }
  /** Requests stay in memory and expose the exact wire envelope. */
  const bodies: string[] = []
  /** An explicit plain format cannot change HTTP's structured envelope or error projection. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { format: formatFeature({ format: 'plain' }) } }),
      httpPlugin({
        url: 'memory-only',
        fetcher: async (_url, init) => {
          bodies.push(init.body)
          return new Response(null, { status: 200 })
        }
      })
    ]
  })
  host.dispatchRaw({ tag: 'error', message: 'failed', args, error, data: { marker: true } })
  host.dispatchRaw({ tag: 'info', message: 'ordinary', args, data: { marker: 'unchanged' } })
  await host.flush()
  /** The envelope retains exactly the entries key rather than a top-level array. */
  const wire = JSON.parse(bodies[0])
  expect(Object.keys(wire)).toEqual(['entries'])
  /** Each native input remains one projected wire entry. */
  const payload = wire.entries[0]
  /** A second ordinary entry preserves nonerror data. */
  const ordinary = JSON.parse(bodies[1]).entries[0]
  expect(payload.error).toEqual(JSON.parse(JSON.stringify(serializeErrorChain(raw))))
  expect(payload.error).toMatchObject({
    source: 'upstream.domain',
    code: 'TOP',
    stack: raw.stack,
    cause: { code: 'CAUSE', stack: cause.stack },
    errors: [{ code: 'SECONDARY', stack: secondary.stack }]
  })
  expect(payload.error).not.toHaveProperty('raw')
  expect(JSON.stringify(payload)).not.toContain('http-top-private')
  expect(JSON.stringify(payload)).not.toContain('http-cause-private')
  expect(JSON.stringify(payload)).not.toContain('http-secondary-private')
  expect(ordinary).toMatchObject({
    message: 'ordinary',
    args: [{ business: true }],
    data: { marker: 'unchanged' }
  })
  expect(error.raw).toBe(raw)
  expect(raw.cause).toBe(cause)
  expect(raw.errors[0]).toBe(secondary)
  expect(args[0]).toBe(object)
  expect(object).toEqual({ business: true })
  await host.shutdown('manual')
}
it('preserves canonical full error projection and excludes private native fields', jsonProjection)

/** HTTP's entry-only delivery must never invoke a host text formatter. */
async function skipTextFormatting(): Promise<void> {
  /** A real formatter would fail every entry if this output incorrectly consumed text. */
  const format = vi.fn(() => {
    throw new Error('HTTP must not format text')
  })
  /** The host admits this descriptor but the HTTP output skips its format phase. */
  const feature = defineLogFeature({ phase: 'format', format })
  /** A public POST is the independent observation of successful entry-only delivery. */
  const fetcher = vi.fn(async () => new Response(null, { status: 200 }))
  /** Structured HTTP output owns serialization while host formatting belongs to other outputs. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: { feature: feature } }),
      httpPlugin({ url: 'memory-only', fetcher })
    ]
  })
  host.log('info', 'entry-only')
  await host.flush()
  expect(format).not.toHaveBeenCalled()
  expect(fetcher).toHaveBeenCalledOnce()
  await host.shutdown('manual')
}
it('skips host text formatting before structured HTTP delivery', skipTextFormatting)
