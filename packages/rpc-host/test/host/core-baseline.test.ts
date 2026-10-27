/** Preserve public lifecycle and native error behavior before moving RPC implementation owners. */
import { deferred } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import { createRpcHost } from '@migaia/rpc-host'
import { RpcLifecycleError } from '@migaia/rpc-host/contract'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'

/** Follow only standard error edges so local cleanup must retain the exact original failure. */
function reachesOriginal(error: unknown, original: Error): boolean {
  /** Shared cause/aggregate children must not make this finite assertion traverse an error twice. */
  const seen = new Set<object>()
  /** A stack avoids repeatedly copying the remaining error graph. */
  const pending: unknown[] = [error]
  while (pending.length > 0) {
    /** Only identity or a real cause/errors edge can prove original error retention. */
    const current = pending.pop()
    if (current === original) return true
    if (!(current instanceof Error) || seen.has(current)) continue
    seen.add(current)
    if (current.cause !== undefined) pending.push(current.cause)
    if (current instanceof AggregateError) pending.push(...current.errors)
  }
  return false
}

/** Own the two provider entries and their independent business completion barrier. */
class HeldProvider {
  /** Both genuine calls must enter business before the test begins public host retirement. */
  readonly #entered = deferred<void>()
  /** Business remains pending until the test releases it after observing caller retirement. */
  readonly #release = deferred<void>()
  /** Count actual provider entries so a post-close invocation cannot silently execute. */
  #started = 0

  /** Resolve only after both actual provider invocations have reached their shared barrier. */
  get entered(): Promise<void> {
    return this.#entered.promise
  }

  /** Expose the business entry count without granting mutation of the fixture state. */
  get started(): number {
    return this.#started
  }

  /** Keep provider execution alive independently from its caller's settlement. */
  readonly hold = async (): Promise<string> => {
    this.#started += 1
    if (this.#started === 2) this.#entered.resolve()
    await this.#release.promise
    return 'late-business-result'
  }

  /** Release held business idempotently during either normal observation or test cleanup. */
  release(): void {
    this.#release.resolve()
  }
}

it('public close shares one Promise and retires concurrent calls with one lifecycle error', async () => {
  /** A real listener and accepted client drive the original public call and close owners. */
  const server = coreMemoryServer('baseline-close')
  /** One named owner retains entry and release state for the two real provider calls. */
  const business = new HeldProvider()
  /** No private Peer or endpoint is acquired by this lifecycle oracle. */
  const host = await createRpcHost(server.options)
  /** Native disposal withdraws the namespace property; this held public surface retains its fence. */
  const memory = host.memory
  /** The existing memory fixture supplies the same real public client used by host tests. */
  const client = await server.connect('provider', {
    provide: { hold: business.hold }
  })
  /** Register both rejection handlers before closing can retire the pending calls. */
  const calls = Promise.allSettled([
    host.memory.send('provider', 'hold'),
    host.memory.send('provider', 'hold')
  ])
  try {
    await business.entered
    /** Both public disposal spellings must retain this exact completion Promise. */
    const closing = host.close()
    expect(host.close()).toBe(closing)
    expect(host[Symbol.asyncDispose]()).toBe(closing)
    /** Session retirement lends one original lifecycle error to both pending calls. */
    const results = await calls
    expect(results[0]!.status).toBe('rejected')
    expect(results[1]!.status).toBe('rejected')
    if (results[0]!.status !== 'rejected' || results[1]!.status !== 'rejected')
      expect.fail('closing must reject both in-flight public requests')
    expect(results[0]!.reason).toBe(results[1]!.reason)
    expect(results[0]!.reason).toBeInstanceOf(RpcLifecycleError)
    expect(results[0]!.reason).toMatchObject({ source: 'rpc.endpoint', code: 'ENDPOINT_DISPOSED' })
    expect((results[0]!.reason as Error).cause).toBeUndefined()
    await closing
    business.release()
    await expect(
      Promise.resolve().then(() => memory.send('provider', 'hold'))
    ).rejects.toMatchObject({ source: 'rpc.endpoint', code: 'ENDPOINT_DISPOSED' })
    expect(business.started).toBe(2)
  } finally {
    business.release()
    await calls
    await client.host.close()
    await host.close()
  }
})

it('public failed close preserves its completion identity and original native cleanup cause', async () => {
  /** The original raw close remains responsible for releasing the accepted physical connection. */
  const server = coreMemoryServer('baseline-close-failure')
  /** Public construction is complete before faulting the actual physical close. */
  const host = await createRpcHost(server.options)
  /** Actual business proves that the accepted connection was usable before retirement. */
  const client = await server.connect('provider', { provide: { echo: (value: unknown) => value } })
  /** This native object must stay reachable through the public close failure's standard edges. */
  const original = new RangeError('baseline physical close failure')
  /** Preserve the existing transport's own release before returning its genuine cleanup failure. */
  const closePhysical = client.pair[0].close
  /** Count only the actual host-owned release; no alternate close implementation is installed. */
  const close = vi.spyOn(client.pair[0], 'close').mockImplementationOnce(() => {
    closePhysical()
    throw original
  })
  try {
    expect(await host.memory.send('provider', 'echo', 42)).toBe(42)
    /** Observe rejection immediately while retaining the exact public Promise for identity checks. */
    const closing = host.close()
    /** The failure belongs to the public close boundary, not an unhandled fixture rejection. */
    const failure = closing.then(
      () => undefined,
      (error: unknown) => error
    )
    expect(host.close()).toBe(closing)
    expect(host[Symbol.asyncDispose]()).toBe(closing)
    /** Translation may add lifecycle containers, but it cannot replace the original native leaf. */
    const error = await failure
    expect(error).toBeInstanceOf(RpcLifecycleError)
    expect(error).toMatchObject({ source: 'rpc.endpoint', code: 'ENDPOINT_DISPOSED' })
    expect(reachesOriginal(error, original)).toBe(true)
    expect(close).toHaveBeenCalledTimes(1)
    expect(host.close()).toBe(closing)
    expect(original).toBeInstanceOf(RangeError)
  } finally {
    close.mockRestore()
    await client.host.close()
    await host.close().catch(() => undefined)
  }
})

it('public provider failure preserves native type source code stack and its original cause chain', async () => {
  /** Native causes carry independent fixture identities so a wrapper cannot flatten the chain. */
  const cause = attachErrorIdentity(new TypeError('baseline provider cause'), {
    source: 'baseline.provider',
    code: 'BUSINESS_CAUSE'
  })
  /** The wire boundary restores this native family and original stack rather than a generic error. */
  const original = attachErrorIdentity(new RangeError('baseline provider failure', { cause }), {
    source: 'baseline.provider',
    code: 'BUSINESS_FAILED'
  })
  /** Existing public hosts and the original memory carrier exercise real serialization. */
  const server = coreMemoryServer('baseline-provider-error')
  /** One public caller sends the provider's actual failure through the existing wire path. */
  const host = await createRpcHost(server.options)
  /** The exact original is thrown by business code, not injected into a response frame. */
  const client = await server.connect('provider', {
    provide: {
      fail: () => {
        throw original
      }
    }
  })
  try {
    /** Observe the actual decoded failure independently from the expected error fields. */
    const failure = await host.memory.send('provider', 'fail').then(
      () => undefined,
      (error: unknown) => error
    )
    expect(failure).toBeInstanceOf(RangeError)
    expect(failure).toMatchObject({
      source: 'baseline.provider',
      code: 'BUSINESS_FAILED',
      message: original.message,
      stack: original.stack
    })
    expect((failure as Error).cause).toBeInstanceOf(TypeError)
    expect((failure as Error).cause).toMatchObject({
      source: 'baseline.provider',
      code: 'BUSINESS_CAUSE',
      message: cause.message,
      stack: cause.stack
    })
  } finally {
    await client.host.close()
    await host.close()
  }
})
