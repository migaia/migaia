/** Original caller cancellation and deadline outcomes cross the actual public Host owners. */
import { createRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { RpcTimeoutError } from '@migaia/rpc-contract/errors'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts, coreMemoryServer } from './core-fixture.ts'

/** One original business holds its late value independently from the caller's terminal outcome. */
class ConstructionLifetimeProvider {
  /** Actual provider entry establishes the original race's active-operation premise. */
  readonly started = deferred<void>()
  /** The original late result is released only during the same case's cleanup. */
  readonly result = deferred<unknown>()
  /** Business completion is observed without fabricating an endpoint controller snapshot. */
  readonly finished = deferred<void>()

  /** Preserve the original late success while production alone handles cancellation and replies. */
  readonly hang = async (_value: unknown, context: IRpcContext) => {
    this.started.resolve()
    try {
      return context.success(await this.result.promise)
    } finally {
      this.finished.resolve()
    }
  }
}

// C071/C090: the new public signal retains the exact original pre-construction reason.
it('pre-aborted public construction retains the original caller reason', async () => {
  /** This is the caller's real native controller, not an injected construction-control port. */
  const controller = new AbortController()
  /** The original native reason must remain reachable without serialization or reconstruction. */
  const reason = new DOMException('pre-abort', 'AbortError')
  controller.abort(reason)
  /** A real supported transport definition preserves construction's original valid-input premise. */
  const server = coreMemoryServer('pre-aborted-construction')
  /** The current public entry may reject before opening; its original error stays unchanged. */
  let failure: unknown
  try {
    await createRpcHost({ ...server.options, signal: controller.signal })
  } catch (error) {
    failure = error
  }
  expect((failure as { cause?: unknown }).cause).toBe(reason)
})

// C070: the complete factory replaces install-time capture, retaining its native getter cause.
it('complete timeout capture retains the original hostile getter cause and one read', () => {
  /** This exact original native exception must survive the public configuration boundary. */
  const hostile = new Error('timeout config getter')
  /** One actual descriptor acquisition belongs to the complete timeout factory. */
  let reads = 0
  /** Changes only the field and capture phase; native acquisition retains this descriptor. */
  const config = {
    get ms(): number {
      reads += 1
      throw hostile
    }
  }
  /** Catch only the genuine factory error, without retagging or wrapping it in the fixture. */
  let failure: unknown
  try {
    timeout(config)
  } catch (error) {
    failure = error
  }
  expect(failure).toMatchObject({ code: 'INVALID_CONFIG', cause: hostile })
  expect(reads).toBe(1)
})

// C075/C094/C095/C096: retain the original terminal type, reason and each owner's close Promise.
it.each(['abort-first', 'timeout-first'] as const)(
  'public operation %s preserves its terminal outcome after the other signal',
  async (order) => {
    /** Both real Hosts finish handshake before fake time controls the original call deadline. */
    const provider = new ConstructionLifetimeProvider()
    /** Canonical Session, Dispatcher and physical carriers remain the only execution owners. */
    const fixture = await connectedCoreHosts({}, { hang: provider.hang }, () => undefined)
    /** The original caller signal competes with a complete executing timeout policy. */
    const controller = new AbortController()
    /** The same native reason remains the abort-first rejection's exact cause. */
    const reason = new DOMException('timeout race caller abort', 'AbortError')
    vi.useFakeTimers()
    /** Observe rejection before either real cancellation source can settle the original Promise. */
    const settled = fixture.a.memory
      .send('b', 'hang', null, { signal: controller.signal, timeout: timeout({ ms: 1 }) })
      .catch((error: unknown) => error)
    try {
      await provider.started.promise
      if (order === 'abort-first') controller.abort(reason)
      await vi.advanceTimersByTimeAsync(1)
      /** Both branches observe the actual public call's original rejection object. */
      const failure = await settled
      if (order === 'abort-first')
        expect(failure).toMatchObject({ name: 'AbortError', cause: reason })
      else {
        expect(failure).toMatchObject({ name: 'TimeoutError' })
        expect(failure).toBeInstanceOf(RpcTimeoutError)
        controller.abort(reason)
        expect(failure).not.toBe(reason)
      }
    } finally {
      provider.result.resolve({ ok: true })
      await provider.finished.promise
      await settled
      vi.useRealTimers()
      /** Each original public owner publishes its own stable cleanup receipt. */
      const clientDispose = fixture.a.close()
      expect(fixture.a.close()).toBe(clientDispose)
      /** The provider's distinct completion is compared only with its own repeated call. */
      const serverDispose = fixture.b.close()
      expect(fixture.b.close()).toBe(serverDispose)
      await Promise.all([clientDispose, serverDispose])
    }
  }
)
