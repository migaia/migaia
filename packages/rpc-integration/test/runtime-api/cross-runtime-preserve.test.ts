import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'

for (const runtime of ['bun', 'deno'] as const) {
  for (const mode of ['process', 'thread'] as const) {
    it(`actual ${runtime} ${mode} keeps portable copy, supported transfer refusal and queued/started cancellation`, () => {
      /**
       * Existing maintained u25 provider and native source selector run inside the selected
       * runtime.
       */
      const entry = fileURLToPath(new URL('./fixtures/runtime-api-parent.mjs', import.meta.url))
      /** No Node substitute grants this receipt; each runtime starts its own real native child. */
      const output = execFileSync(
        runtime,
        runtime === 'deno' ? ['run', '-A', entry, runtime, mode] : [entry, runtime, mode],
        { encoding: 'utf8', timeout: 30000 }
      )
      /**
       * The child emits the receipt only after its actual public business and lease assertions
       * pass.
       */
      const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
      assert.equal(receipt.runtime, runtime)
      assert.equal(receipt.mode, mode)
      for (const expected of [
        'ordered-queued-cancel',
        'stream-discard',
        'portable-binary-copy',
        'default-transfer-refusal',
        'started-signal-lease',
        'started-deadline-lease'
      ])
        assert.ok(receipt.cases.includes(expected))
    }, 40000)
    it(`actual ${runtime} ${mode} keeps named connect/listen and native one-hop forwarding`, () => {
      /**
       * The same canonical Host/Plugin slots reach a real native final provider, never a forwarding
       * stub.
       */
      const entry = fileURLToPath(new URL('./fixtures/native-connect-relay.mjs', import.meta.url))
      /** Parent and child both execute in this exact runtime. */
      const output = execFileSync(
        runtime,
        runtime === 'deno' ? ['run', '-A', entry, runtime, mode] : [entry, runtime, mode],
        { encoding: 'utf8', timeout: 30000 }
      )
      /** The receipt follows real connect/listen/reverse/business assertions. */
      const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
      assert.equal(receipt.effects, 1)
      assert.equal(receipt.runtime, runtime)
      assert.equal(receipt.mode, mode)
      assert.deepEqual(receipt.cases, [
        'named-connect',
        'named-listen',
        'actual-native-one-hop',
        'reverse'
      ])
    }, 40000)
  }
}
