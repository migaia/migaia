import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { deferred } from '@migaia/utils/promise'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { timeoutFeature } from '@migaia/rpc-host/features/timeout'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'
import { RuntimeApiFixtureText } from '../fixtures/runtime-api-text.ts'

/** Each original case controls one genuine authentication suspension, never a replacement sender. */
class SigningControl {
  /** The selected terminal path stays fixed throughout this original authentication operation. */
  readonly #control: 'abort' | 'deadline' | 'late-failure'
  /** Only the next real caller sign callback may be held after baseline authentication succeeds. */
  #hold = false
  /** The original callback joins this explicit release after its real entry has been observed. */
  readonly #held = deferred<void>()
  /** Entry proves cancellation happens during genuine asynchronous signature preparation. */
  readonly entered = deferred<void>()
  /** The original native failure must remain the same cause in the late diagnostic. */
  readonly lateFailure = new RangeError(RuntimeApiFixtureText.lateAuthentication)
  /** Only real public host reports participate in the original exact diagnostic assertions. */
  readonly failures: unknown[] = []

  /** Capture only the original parameterized case, without constructing an RPC owner. */
  constructor(control: 'abort' | 'deadline' | 'late-failure') {
    this.#control = control
  }

  /** Install the actual complete auth factory on each real public host before transport startup. */
  protection(caller: boolean) {
    /** This small callback context names its two inputs rather than sharing fixture closure state. */
    const operation = { owner: this, caller }
    return authFeature({
      sign: (value) => operation.owner.#sign(value, operation.caller),
      verify: this.#verify
    })
  }

  /** Arm only after the original real ready request has completed. */
  arm(): void {
    this.#hold = true
  }

  /** Release the same original callback even when a RED assertion triggers cleanup early. */
  release(): void {
    this.#held.resolve()
  }

  /** Reports remain observable without changing the original authentication/native error. */
  readonly report = (error: unknown): void => {
    this.failures.push(error)
  }

  /** Preserve the original real HMAC transform before and after the single controlled suspension. */
  async #sign(value: unknown, caller: boolean): Promise<unknown> {
    if (caller && this.#hold) {
      this.#hold = false
      this.entered.resolve()
      await this.#held.promise
      if (this.#control === 'late-failure') throw this.lateFailure
    }
    return { value, signature: this.#signature(value) }
  }

  /** The fixed public fixture key signs actual protected counter/nonce content on both sides. */
  #signature(value: unknown): string {
    return createHmac('sha256', 'public-fixture-key').update(JSON.stringify(value)).digest('hex')
  }

  /** Keep the original signature assertion at the real verify callback, without a successful stub. */
  readonly #verify = (value: unknown): unknown => {
    /** Actual transformed values retain both original content and their complete-frame signature. */
    const frame = value as { value: unknown; signature: string }
    assert.equal(frame.signature, this.#signature(frame.value))
    return frame.value
  }
}

for (const control of ['abort', 'deadline', 'late-failure'] as const) {
  it(`${control} during asynchronous signing withdraws the one-way frame before physical send`, async () => {
    /** One named owner retains only this original sign callback's controlled resources. */
    const signing = new SigningControl(control)
    /** Cold inline storage selects real SDK JSON capture on the original existing carrier pair. */
    const server = coreMemoryServer('caller', 'signing-caller', 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false
    })
    /** Native plugin installation owns real auth setup before the same original transport starts. */
    const caller = await createRpcHost({
      ...server.options,
      plugins: [signing.protection(true), ...server.options.plugins!],
      report: signing.report
    })
    /** A partially acquired provider remains available to the same final cleanup owner. */
    let provider: IRpcHost | undefined
    try {
      /** The original native connection performs both authenticating handshakes and deliveries. */
      const connected = await server.connect('provider', {
        provide: { ready: () => 'ready' },
        plugins: [signing.protection(false)],
        report: signing.report
      })
      provider = connected.host
      assert.equal(await caller.memory.send('provider', 'ready', null), 'ready')
      /** Observe actual physical writes after baseline; no fixture queue or receipt is introduced. */
      const writing = vi.spyOn(connected.pair[0], 'write')
      try {
        /** Native caller cancellation retains its original local reason identity. */
        const reason = new Error(RuntimeApiFixtureText.signingAbort)
        /** Only this original notification is cancelled; the later recovery request remains live. */
        const controller = new AbortController()
        signing.arm()
        /** A complete timeout instance replaces the retired numeric per-call configuration. */
        const pending = caller.memory.notify(
          'ready',
          null,
          control !== 'deadline'
            ? { signal: controller.signal }
            : { timeout: timeoutFeature({ ms: 10, report: signing.report }) }
        )
        /** Observe before abort so the original expected rejection cannot become detached. */
        const settlement = Promise.allSettled([pending])
        await signing.entered.promise
        if (control !== 'deadline') controller.abort(reason)
        await settlement
        signing.release()
        await nextTurn()
        assert.equal(await caller.memory.send('provider', 'ready', null), 'ready')
        assert.equal(
          writing.mock.calls.length,
          1,
          'an aborted signing operation emits zero notification frames'
        )
        if (control === 'late-failure') {
          /** Only exact original cause identity satisfies the original late diagnostic contract. */
          const reported = signing.failures.find(
            (error) => (error as { cause?: unknown }).cause === signing.lateFailure
          ) as { source?: string; code?: string; name?: string } | undefined
          assert.ok(reported, 'late transform failure is reported with its original cause')
          assert.equal(reported.source, 'rpc.endpoint')
          assert.equal(reported.code, 'AUTHENTICATION_FAILED')
        }
        /** Keep the original terminal code and caller cause identity for every parameterized path. */
        const [result] = await settlement
        assert.equal(result?.status, 'rejected', 'abort during signing remains observable')
        if (result?.status === 'rejected') {
          assert.equal(
            result.reason.code,
            control !== 'deadline' ? 'CANCELLED' : 'DEADLINE_EXCEEDED'
          )
          if (control !== 'deadline') assert.equal(result.reason.cause, reason)
        }
      } finally {
        writing.mockRestore()
      }
    } finally {
      signing.release()
      await caller.close()
      await provider?.close()
    }
  })
}
