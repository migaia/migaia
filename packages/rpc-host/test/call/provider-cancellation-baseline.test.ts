import { deferred } from '@migaia/utils/promise'
import type { IRpcContext } from '@migaia/rpc-host'
import { describe, expect, it } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

/** The real provider signal and business finally expose cancellation without a controller registry. */
class AbortBaselineProvider {
  /** Actual entry precedes the caller's cancellation in each original scenario. */
  readonly started = deferred<void>()
  /** Actual business completion replaces the deleted endpoint's private controller observation. */
  readonly finished = deferred<void>()
  /** Only original provider entry/finally change this public business activity observation. */
  #active = 0

  /** Read business activity without granting access to Dispatcher/controller internals. */
  get active(): number {
    return this.#active
  }

  /** Preserve the original late success after its admitted cancellation signal fires. */
  readonly run = async (_payload: unknown, context: IRpcContext) => {
    this.#active += 1
    this.started.resolve()
    try {
      if (!context.signal.aborted)
        await new Promise<void>((resolve) =>
          context.signal.addEventListener('abort', () => resolve(), { once: true })
        )
      return context.success('late')
    } finally {
      this.#active -= 1
      this.finished.resolve()
    }
  }
}

describe('public provider cancellation baseline', () => {
  it('preserves the caller DOMException cause and releases the running provider', async () => {
    /** The native memory pair and namespaces retain their actual production cancellation owners. */
    const provider = new AbortBaselineProvider()
    /** This original fixture installs one actual provider, with no private middleware setup. */
    const fixture = await connectedCoreHosts({}, { wait: provider.run }, () => undefined)
    try {
      /** This exact original native instance must remain the local rejection cause. */
      const reason = new DOMException('provider caller abort', 'AbortError')
      /** One caller signal controls only this original invocation. */
      const controller = new AbortController()
      /** The full false override replaces the retired numeric timeout option. */
      const pending = fixture.a.memory.send('b', 'wait', null, {
        signal: controller.signal,
        timeout: false
      })
      /** Attach before abort so the original rejection cannot become detached. */
      const rejection = expect(pending).rejects.toMatchObject({ cause: reason })
      await provider.started.promise
      controller.abort(reason)
      await rejection
      await provider.finished.promise
      expect(provider.active).toBe(0)
    } finally {
      await fixture.close()
    }
  })

  it('repeated caller abort preserves the cause, releases work and retains its one provider', async () => {
    /** Duplicate cancellation cannot create another provider execution or replace its terminal. */
    const provider = new AbortBaselineProvider()
    /** The public directory belongs to the same native registration used by the original call. */
    const fixture = await connectedCoreHosts({}, { wait: provider.run }, () => undefined)
    try {
      /**
       * Preserve the original repeated AbortController operation rather than injecting cancel
       * frames.
       */
      const controller = new AbortController()
      /** The operation crosses the genuine memory carrier before cancellation is issued. */
      const pending = fixture.a.memory.send('b', 'wait', null, {
        signal: controller.signal,
        timeout: false
      })
      /** Preserve the original Error object as the correlated local cause. */
      const reason = new Error('cancelled')
      /** Observe the original Promise before either repeated event can settle it. */
      const rejection = expect(pending).rejects.toMatchObject({ cause: reason })
      await provider.started.promise
      controller.abort(reason)
      controller.abort(reason)
      await rejection
      await provider.finished.promise
      expect(provider.active).toBe(0)
      expect(Object.keys(fixture.a.memory.peers.b!).length).toBe(1)
    } finally {
      await fixture.close()
    }
  })

  it('preserves the primitive caller cause and both original namespace close Promises', async () => {
    /** The same public provider exposes actual signal delivery and business terminal cleanup. */
    const provider = new AbortBaselineProvider()
    /** A namespace replaces each retired composed endpoint as the physical cleanup owner. */
    const fixture = await connectedCoreHosts({}, { wait: provider.run }, () => undefined)
    try {
      /** The caller's primitive reason must not be reconstructed from a wire Error. */
      const controller = new AbortController()
      /** Retain the exact original fixture reason. */
      const reason = 'primitive-r71-reason'
      /** Cancellation is local while its remote notification travels over the actual carrier. */
      const pending = fixture.a.memory.send('b', 'wait', null, {
        signal: controller.signal,
        timeout: false
      })
      /** Attach the unchanged original matcher before issuing cancellation. */
      const rejection = expect(pending).rejects.toMatchObject({ cause: reason })
      await provider.started.promise
      controller.abort(reason)
      await rejection
      await provider.finished.promise
      expect(provider.active).toBe(0)
    } finally {
      /** The actual namespace owns one stable cleanup Promise for the former client endpoint. */
      const clientDispose = fixture.a.memory.close()
      expect(fixture.a.memory.close()).toBe(clientDispose)
      await clientDispose
      /** The independent server namespace retains its own original idempotent completion. */
      const serverDispose = fixture.b.memory.close()
      expect(fixture.b.memory.close()).toBe(serverDispose)
      await serverDispose
      await fixture.close()
    }
  })
})
