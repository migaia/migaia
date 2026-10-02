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
      `[A7] ${runtime} prevents native Worker error from terminating the host`,
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
          termination: 'unsupported'
        })
        expect(receipt.nativePosts).toBeGreaterThan(0)
        if (runtime === 'deno') expect(receipt.prevented).toEqual([true])
      },
      15_000
    )
  }
})
