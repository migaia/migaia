import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'

for (const runtime of ['bun', 'deno'] as const) {
  for (const mode of ['process', 'thread'] as const) {
    it(`[R14-A11] actual ${runtime} ${mode} keeps portable copy, supported transfer refusal and queued/started cancellation`, () => {
      /**
       * Existing maintained u25 provider and native source selector run inside the selected
       * runtime.
       */
      const entry = fileURLToPath(new URL('./fixtures/runtime-u25-parent.mjs', import.meta.url))
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
    it(`[R14-A11] actual ${runtime} ${mode} keeps TCP connect/listen and native one-hop forwarding`, () => {
      /**
       * The same canonical Host/Plugin slots reach a real native final provider, never a forwarding
       * stub.
       */
      const entry = fileURLToPath(
        new URL('./fixtures/r14-native-connect-relay.mjs', import.meta.url)
      )
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
        'tcp-connect',
        'authenticated-listen',
        'actual-native-one-hop',
        'reverse'
      ])
    }, 40000)
  }
  it(`[R14-A11] actual ${runtime} opt-in native Thread binary keeps copy, transfer, aliases and lazy original stream`, () => {
    /**
     * Reuse the original Bun qualification; Deno uses the same maintained fixture emitted as
     * concrete modules.
     */
    const entry = fileURLToPath(
      new URL(
        runtime === 'bun'
          ? './fixtures/bun-binary-parent.mjs'
          : './fixtures/r14-deno-binary-parent.mjs',
        import.meta.url
      )
    )
    /** Native WebCrypto and the actual clone-transfer Worker execute every operation. */
    const output = execFileSync(runtime, runtime === 'deno' ? ['run', '-A', entry] : [entry], {
      encoding: 'utf8',
      timeout: 30000
    })
    /** Assertion-bearing qualification records actual backing detachment and alias restoration. */
    const receipt = JSON.parse(output.trim().split('\n').at(-1)!)
    assert.equal(receipt.copy.senderLength, 4)
    assert.equal(receipt.transfer.senderLength, 0)
    assert.equal(receipt.transfer.firstLength, 0)
    assert.equal(receipt.transfer.secondLength, 0)
    assert.equal(receipt.transfer.alias, true)
    assert.equal(receipt.streamed.beforeNext, 2)
    assert.equal(receipt.streamed.senderLength, 0)
    assert.equal(receipt.count, 6)
    assert.deepEqual(receipt.failures, [])
    /** Repeated native close preserves identity and completion without inventing exit support. */
    assert.deepEqual(receipt.closure, { samePromise: true, completed: true })
    /**
     * Closing reports retain complete source/code/name/reason/cause after the fixed business
     * cutoff.
     */
    console.log(
      'R14-A11 native binary phases',
      JSON.stringify({
        runtime,
        businessCount: receipt.count,
        businessFailures: receipt.failures,
        closing: receipt.closing
      })
    )
    assert.equal(
      receipt.closing.every(
        (event: { phase: string; businessComplete: boolean }) =>
          event.phase === 'closing' && event.businessComplete
      ),
      true
    )
  }, 40000)
}
