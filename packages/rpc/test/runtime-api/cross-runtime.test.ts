import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'

/** Both runtime toolchains are required; absent platforms remain failures, never surrogate PASS. */
const entry = fileURLToPath(new URL('./fixtures/cross-runtime-parent.mjs', import.meta.url))
for (const runtime of ['bun', 'deno'] as const) {
  for (const mode of ['process', 'thread'] as const) {
    it(`[A2][A17] ${runtime} ${mode} adopts its actual original adapter and child bootstrap`, () => {
      /** Native runtime executes both endpoints; stdout carries only an independent fixture receipt. */
      const args = runtime === 'deno' ? ['run', '-A', entry, mode] : [entry, mode]
      /** A finite local bound prevents a failed source from leaving an unattended child process. */
      const output = execFileSync(runtime, args, { encoding: 'utf8', timeout: 15000 })
      /** The actual business assertions run inside the runtime before this receipt is emitted. */
      const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
      assert.deepEqual(
        receipt,
        {
          runtime,
          mode,
          forwardCalls: 1,
          reverseCalls: 1,
          identityMatched: true,
          secretVisible: false
        },
        '[A2] actual platform business receipt matches both directions'
      )
    }, 20000)
  }
}
