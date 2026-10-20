import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('constructs the ordinary Bun URL spawn and calls its actual Worker', () => {
  /** Bun executes a genuine service child through the current public built package. */
  const fixture = fileURLToPath(new URL('./fixtures/audit-bun-short.mts', import.meta.url))
  /** Unsupported actual-exit observation retains its existing bounded shutdown policy. */
  const output = execFileSync('bun', [fixture], { encoding: 'utf8', timeout: 25_000 })
  expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({ value: 'actual-bun-worker' })
}, 30_000)

it('applies the local capability restriction after an actual bilateral Worker ACK', () => {
  /** The real public launcher supplies preparation; the caller only configures its public factory. */
  const fixture = fileURLToPath(new URL('./fixtures/audit-bun-short.mts', import.meta.url))
  /** The request still executes while the optional stream capability stays disabled. */
  const output = execFileSync('bun', [fixture, 'policy'], { encoding: 'utf8', timeout: 25_000 })
  expect(JSON.parse(output.trim().split('\n').at(-1)!)).toEqual({
    value: 'actual-bun-worker',
    requestedStream: false,
    observedStream: false
  })
}, 30_000)
