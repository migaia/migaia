import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Each fixture executes against built ESM in an actual platform rather than an EventTarget shim. */
const entry = fileURLToPath(new URL('./fixtures/web-error-host.mjs', import.meta.url))

describe('Web Worker platform error cancellation', () => {
  for (const runtime of ['bun', 'deno'] as const) {
    /** Missing platforms remain unsupported, with no success claim from another runtime. */
    const available = spawnSync(runtime, ['--version']).status === 0
    it.skipIf(!available)(
      `${runtime} prevents native Worker error from terminating the host`,
      () => {
        /** Deno permissions apply only to this local fixture and its workspace imports. */
        const args = runtime === 'deno' ? ['run', '-A', entry] : [entry]
        /**
         * The child must produce the assertion receipt and finish within its explicit fixture
         * bound.
         */
        const output = execFileSync(runtime, args, { encoding: 'utf8', timeout: 10_000 })
        /** Final output contains no original error contents or protocol payloads. */
        const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
        expect(receipt).toMatchObject({
          hostAlive: true,
          preventCalls: [1],
          reports: 1,
          termination: runtime === 'deno' ? 'unsupported' : 'enforced',
          resourceSampler: 'undefined'
        })
        expect(receipt.nativePosts).toBeGreaterThan(0)
        if (runtime === 'deno') expect(receipt.prevented).toEqual([true])
        /** Bun's close event settles exited with a numeric code after terminate. */
        if (runtime === 'bun') expect(receipt.exitCode).toEqual(expect.any(Number))
      },
      15_000
    )
  }
})

describe('Deno owned Worker exit-observation boundary', () => {
  /** The fixture uses a genuine local Deno runtime; another host cannot prove this boundary. */
  const available = spawnSync('deno', ['--version']).status === 0
  it.skipIf(!available)(
    'reports EXIT_UNOBSERVABLE promptly instead of waiting for reap',
    () => {
      /** Deno executes TypeScript directly while importing the ordinary built package entries. */
      const fixture = fileURLToPath(new URL('./fixtures/deno-owned-exit.mts', import.meta.url))
      /** Successful business output cannot bypass the assertions on all close diagnostics. */
      const output = execFileSync('deno', ['run', '-A', fixture], {
        encoding: 'utf8',
        timeout: 15_000
      })
      /** Assertion output includes full classification and timing when the old timeout reproduces. */
      const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
      expect(receipt.value).toBe('actual-deno-owned-worker')
      expect(receipt.admissionDiagnostics).toEqual([
        expect.objectContaining({ source: '@migaia/supervision', code: 'CAPABILITY_UNSUPPORTED' })
      ])
      expect(receipt.closeDiagnostics, JSON.stringify(receipt)).toEqual([
        expect.objectContaining({
          source: '@migaia/supervision',
          code: 'EXIT_UNOBSERVABLE',
          name: 'Error',
          detail: { kind: 'thread', generation: 1, phase: 'exit', capability: 'exit-observation' },
          message: expect.any(String)
        })
      ])
      expect(JSON.stringify(receipt.closeDiagnostics)).not.toMatch(
        /"code":"(?:REAP_TIMEOUT|DISPOSE_STEP_TIMEOUT)"/
      )
      expect(receipt.elapsedMs, JSON.stringify(receipt)).toBeLessThan(receipt.reapTimeoutMs / 2)
    },
    20_000
  )
})
