import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { serializeErrorChain } from '@migaia/utils/error'
import { filePlugin } from '../src/index.ts'

/**
 * Every raw/cause/aggregate branch has a different private field that must stay off structured
 * wire.
 */
async function jsonProjection(): Promise<void> {
  /** Cause identity and stack must survive without serializing its enumerable private fields. */
  const cause = Object.assign(new TypeError('cause'), {
    source: 'upstream.domain',
    code: 'CAUSE',
    privateCause: 'file-cause-private'
  })
  /** Aggregate branches are independent from the cause chain and need their own projection. */
  const secondary = Object.assign(new RangeError('secondary'), {
    source: 'upstream.domain',
    code: 'SECONDARY',
    privateSecondary: 'file-secondary-private'
  })
  /** The original aggregate carries a third private sentinel and the original cause object. */
  const raw = Object.assign(new AggregateError([secondary], 'top', { cause }), {
    source: 'upstream.domain',
    code: 'TOP',
    privateTop: 'file-top-private'
  })
  /** An ordinary payload remains native and is never modified by error projection. */
  const object = { business: true }
  /** The input argument container remains caller-owned after dispatch. */
  const args = [object]
  /** Native error info is supplied separately from args to isolate the documented error projection. */
  const error = { name: raw.name, message: raw.message, stack: raw.stack, raw }
  /** The injected append capability receives the host's complete NDJSON text. */
  const writes: string[] = []
  /** No explicit format is supplied, so file selects the host's JSON fallback. */
  const host = createLogHost({
    plugins: [
      filePlugin({
        path: 'memory.ndjson',
        writer: {
          async append(_path, text) {
            writes.push(text)
          }
        }
      })
    ]
  })
  host.dispatchRaw({ tag: 'error', message: 'failed', args, error, data: { marker: true } })
  host.dispatchRaw({ tag: 'info', message: 'ordinary', args, data: { marker: 'unchanged' } })
  await host.flush()
  /** A complete line is projected JSON, including its trailing NDJSON newline. */
  const payload = JSON.parse(writes[0])
  /** A second ordinary line retains the original nonerror fields. */
  const ordinary = JSON.parse(writes[1])
  expect(writes[0].endsWith('\n')).toBe(true)
  expect(payload.error).toEqual(JSON.parse(JSON.stringify(serializeErrorChain(raw))))
  expect(payload.error).toMatchObject({
    source: 'upstream.domain',
    code: 'TOP',
    stack: raw.stack,
    cause: { code: 'CAUSE', stack: cause.stack },
    errors: [{ code: 'SECONDARY', stack: secondary.stack }]
  })
  expect(payload.error).not.toHaveProperty('raw')
  expect(JSON.stringify(payload)).not.toContain('file-top-private')
  expect(JSON.stringify(payload)).not.toContain('file-cause-private')
  expect(JSON.stringify(payload)).not.toContain('file-secondary-private')
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
