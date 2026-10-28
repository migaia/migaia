import { expect, it, vi } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { serializeErrorChain } from '@migaia/utils/error'
import { consolePlugin } from '../src/index.ts'
import { MemoryConsole } from './fixtures.ts'

/**
 * Every raw/cause/aggregate branch has a different private field that must stay off structured
 * wire.
 */
async function jsonProjection(): Promise<void> {
  /** Cause identity and stack must survive without serializing its enumerable private fields. */
  const cause = Object.assign(new TypeError('cause'), {
    source: 'upstream.domain',
    code: 'CAUSE',
    privateCause: 'console-cause-private'
  })
  /** Aggregate branches are independent from the cause chain and need their own projection. */
  const secondary = Object.assign(new RangeError('secondary'), {
    source: 'upstream.domain',
    code: 'SECONDARY',
    privateSecondary: 'console-secondary-private'
  })
  /** The original aggregate carries a third private sentinel and the original cause object. */
  const raw = Object.assign(new AggregateError([secondary], 'top', { cause }), {
    source: 'upstream.domain',
    code: 'TOP',
    privateTop: 'console-top-private'
  })
  /** An ordinary payload remains native and is never modified by error projection. */
  const object = { business: true }
  /** The input argument container remains caller-owned after dispatch. */
  const args = [object]
  /** Native error info is supplied separately from args to isolate the documented error projection. */
  const error = { name: raw.name, message: raw.message, stack: raw.stack, raw }
  vi.stubEnv('LOG_FORMAT', 'json')
  /** Default JSON must come from the host's selected fallback formatter. */
  const console = new MemoryConsole()
  /** The output is a real console plugin with no explicit formatting override. */
  const host = createLogHost({ plugins: [consolePlugin({ console })] })
  host.dispatchRaw({ tag: 'error', message: 'failed', args, error, data: { marker: true } })
  host.dispatchRaw({ tag: 'info', message: 'ordinary', args, data: { marker: 'unchanged' } })
  await host.flush()
  /** Console JSON is its single text argument, never a native error object. */
  const payload = JSON.parse(String(console.errors[0][0]))
  /** A nonerror entry keeps its ordinary shape beside the projected error record. */
  const ordinary = JSON.parse(String(console.logs[0][0]))
  expect(console.errors[0]).toHaveLength(1)
  expect(payload.error).toEqual(JSON.parse(JSON.stringify(serializeErrorChain(raw))))
  expect(payload.error).toMatchObject({
    source: 'upstream.domain',
    code: 'TOP',
    stack: raw.stack,
    cause: { code: 'CAUSE', stack: cause.stack },
    errors: [{ code: 'SECONDARY', stack: secondary.stack }]
  })
  expect(payload.error).not.toHaveProperty('raw')
  expect(JSON.stringify(payload)).not.toContain('console-top-private')
  expect(JSON.stringify(payload)).not.toContain('console-cause-private')
  expect(JSON.stringify(payload)).not.toContain('console-secondary-private')
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
  vi.unstubAllEnvs()
}
it('preserves canonical full error projection and excludes private native fields', jsonProjection)
