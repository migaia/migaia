/** Public close cancels native verification without retaining a user callback or execution lease. */
import { createRpcHost } from '@migaia/rpc-host'
import auth, { type IRpcAuthenticationTransform } from '@migaia/rpc-host/plugins/auth'
import { RpcJsonCarrierCodec } from '@migaia/rpc-host/sdk'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from '../host/core-fixture.ts'

/** One application-owned verifier gate records the signal supplied by its real native Session. */
class ClosingVerification {
  /** Startup traffic passes unchanged; one genuine business input later consumes this arm. */
  #armed = false
  /** The existing transform's original signal is observed without constructing another controller. */
  readonly entered = deferred<IAbortSignal>()
  /** The user callback deliberately remains pending until after public close has completed. */
  readonly release = deferred<void>()

  /** Hold only the next actual callback, after a real barrier has drained startup traffic. */
  hold(): void {
    this.#armed = true
  }

  /** The real configured verifier retains its original opaque value until the application settles. */
  readonly verify: IRpcAuthenticationTransform = (value, context) => {
    if (!this.#armed) return value
    this.#armed = false
    this.entered.resolve(context.signal)
    return this.release.promise.then(() => value)
  }
}

it.each(['fulfilled', 'rejected'] as const)(
  'closes before an ignored verifier settles and applies cancellation reporting to its late %s result',
  async (outcome) => {
    /** Only actual provider entry can change this business observation. */
    const delivered: unknown[] = []
    /** Raw original diagnostics remain available after the real public Host releases resources. */
    const failures: unknown[] = []
    /** This is application input suspension, not a replacement queue, pipeline or dispatcher. */
    const verifier = new ClosingVerification()
    /** Explicit closing support exercises the same real keepalive path as native transports. */
    const server = coreMemoryServer('provider', 'provider', 'memory', [], [], {
      create: () => new RpcJsonCarrierCodec(),
      nativeBinary: false,
      closingWrites: true
    })
    /** Genuine Auth and business setup run under the one ordinary public Host owner. */
    const host = await createRpcHost({
      ...server.options,
      plugins: [
        auth({ sign: (value) => value, verify: verifier.verify }),
        ...server.options.plugins
      ],
      report: (error) => failures.push(error),
      provide: {
        barrier: (value) => value,
        echo: (value) => {
          delivered.push(value)
          return value
        }
      }
    })
    /** The caller's independent Auth and actual native pair perform both real handshakes. */
    const client = await server.connect('caller', {
      plugins: [auth({ sign: (value) => value, verify: (value) => value })]
    })
    /** The original public request is observed until its actual source is retired. */
    let pending: Promise<unknown> | undefined
    /** This exact original rejection must remain reachable through the late Auth diagnostic. */
    const original = new RangeError('late verification fixture')
    try {
      await client.host.memory.send('provider', 'barrier')
      verifier.hold()
      pending = client.host.memory.send('provider', 'echo', 'late').catch((error: unknown) => error)
      /** The actual native transform supplies its original operation signal. */
      const signal = await verifier.entered.promise
      /** Public close must also release the native execution lease before user verification settles. */
      const closing = host.close()
      expect(host.close()).toBe(closing)
      /** This observation records only original public completion, never fabricates close readiness. */
      let closed = false
      const settled = closing.then(() => {
        closed = true
      })
      await vi.waitFor(() => expect(signal.aborted).toBe(true))
      await vi.waitFor(() => expect(closed).toBe(true))
      await settled
      expect(delivered).toEqual([])
      /** Capture the true close diagnostics before releasing the actual late application result. */
      const before = failures.length
      if (outcome === 'fulfilled') verifier.release.resolve()
      else verifier.release.reject(original)
      /** Discards late success; an independent verifier rejection still reports its exact cause. */
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(failures).toHaveLength(before + (outcome === 'rejected' ? 1 : 0))
      if (outcome === 'rejected') {
        expect(failures.at(-1)).toMatchObject({
          source: 'rpc.endpoint',
          code: 'AUTHENTICATION_FAILED'
        })
        expect((failures.at(-1) as Error).cause).toBe(original)
      }
      expect(delivered).toEqual([])
      await Promise.resolve()
      await Promise.resolve()
      expect(failures).toHaveLength(before + (outcome === 'rejected' ? 1 : 0))
    } finally {
      verifier.release.resolve()
      await Promise.all([client.host.close(), host.close()])
      await pending
    }
  }
)
