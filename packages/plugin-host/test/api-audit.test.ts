import { describe, expect, it } from 'vitest'
import { defineHost, definePlugin, PluginHost } from '../src/index.js'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import * as composition from '../src/composition-entry.js'

/** Memory fixtures disable unrelated operation/drain deadlines. */
const execution = { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } as const

describe('audited plugin host contracts', () => {
  it('keeps managed-host registration authority inside the package', async () => {
    expect('registerManagedHost' in composition).toBe(false)
    expect('buildManagedPort' in composition).toBe(false)
    /** Public factories are the legitimate writers of managed-host provenance. */
    const host = defineHost({ host: { execution } })
    /** A plain object has no public registration path or managed port. */
    const ordinary = {}
    expect(composition.isManagedHost(host)).toBe(true)
    expect(composition.isManagedHost(ordinary)).toBe(false)
    expect(() => composition.openComposition(ordinary)).toThrow(
      expect.objectContaining({ code: 'COMPOSITION_TARGET_UNMANAGED' })
    )
    await host.dispose()
  })

  it('rejects prepared removal of a replaced generation before repeating its cleanup', async () => {
    /** Counts stay generation-local even though both registrations use one public name. */
    let oldDisposals = 0
    let newDisposals = 0
    /** One factory host owns both registration generations and their composition tokens. */
    const host = defineHost({ host: { execution } })
    /** Only canonical public composition operations prepare and commit these receipts. */
    const port = composition.openComposition(host)
    /** Stable ordering lane is independent of a particular installed generation. */
    const slot = port.createDataOrderSlot('generation')
    /** Original plugin is disposed once by replacement. */
    const original = definePlugin({
      name: 'generation',
      install: () => ({ read: () => 'old' }),
      dispose: () => {
        oldDisposals++
      }
    })
    /** Prepared admission supplies an exact generation-bound receipt. */
    const admission = await port.prepareAdmissions([
      { admission: port.createPluginAdmission(original), slot }
    ])
    /** The removal token retains the original generation, never whichever later shares its name. */
    const receipts = port.commitPreparedAdmissions(admission)
    const removal = port.prepareUnUseBatch(receipts)
    /** Replacement is a separate generation that must remain live after stale removal rejects. */
    const current = await host.replace(
      'generation',
      definePlugin({
        name: 'generation',
        install: () => ({ read: () => 'new' }),
        dispose: () => {
          newDisposals++
        }
      })
    )
    await expect(port.commitPreparedUnUseBatch(removal, {})).rejects.toMatchObject({
      code: 'PLUGIN_NOT_INSTALLED'
    })
    expect(oldDisposals).toBe(1)
    expect(newDisposals).toBe(0)
    expect(current.extensions.read()).toBe('new')
    await host.dispose()
    expect(oldDisposals).toBe(1)
    expect(newDisposals).toBe(1)
  })
  it('publishes the factory disposal promise before middleware reenters', async () => {
    /** Reentrant call observes the one disposal chain while middleware still executes synchronously. */
    let nested: Promise<unknown> | undefined
    let middlewareCalls = 0
    let host!: ReturnType<typeof defineHost>
    host = defineHost({
      host: { execution },
      dispose: (next) => {
        middlewareCalls++
        if (middlewareCalls === 1) nested = host.dispose()
        return next()
      }
    })
    /** Every public caller, including the nested one, receives the prepublished native Promise. */
    const outer = host.dispose()
    await outer
    expect(middlewareCalls).toBe(1)
    expect(nested).toBe(outer)
    expect(host.dispose()).toBe(outer)
  })

  it('publishes the runtime disposal promise before synchronous abort notification', async () => {
    /** Subclassing uses the existing protected pipeline entry, without exposing a new runtime seam. */
    class DispatchHost extends PluginHost<object, string> {
      /** Runs a supported sync pipeline to capture its host-owned signal. */
      dispatch(): void {
        this.runPipeline('value', () => undefined)
      }
    }
    /** Legacy class and functional facade must share the same reentrancy guarantee. */
    const host = new DispatchHost({ execution })
    /** Pipeline contexts expose the exact host execution signal used for cooperative cancellation. */
    let signal!: IAbortSignal
    let nested: Promise<unknown> | undefined
    host.usePipeline((value, next, context) => {
      signal = context!.signal
      next(value)
    })
    host.dispatch()
    signal.addEventListener(
      'abort',
      () => {
        nested = host.dispose()
      },
      { once: true }
    )
    /** Abort listeners run before dispose returns, so the cache must already be published. */
    const outer = host.dispose()
    await outer
    expect(nested).toBe(outer)
    expect(host.dispose()).toBe(outer)
  })
  it('assimilates one legal update thenable once under a finite deadline', async () => {
    /** Only the custom result counts assimilation; the native Promise delegates its generic typing. */
    let thenCalls = 0
    /** A valid lifecycle PromiseLike makes each extra assimilation observable. */
    const thenable: PromiseLike<void> = {
      // oxlint-disable-next-line unicorn/no-thenable -- exercises the supported PromiseLike contract.
      then(onFulfilled, onRejected) {
        thenCalls++
        return Promise.resolve().then(onFulfilled, onRejected)
      }
    }
    /** A positive finite operation budget exercises boundedWait and the final result read. */
    const host = defineHost({
      host: { execution: { mutationTimeoutMs: 500, pipelineDrainTimeoutMs: false } }
    })
    await host.use(
      definePlugin({
        name: 'config',
        config: { value: 1 },
        install: () => ({}),
        update: () => thenable
      })
    )
    await host.config.update('config', () => ({ value: 2 }))
    expect(thenCalls).toBe(1)
    await host.dispose()
  })
  it.each(['recipe', 'update', 'dispose'] as const)(
    'identifies a native public %s callback failure without replacing it',
    async (kind) => {
      /** Callback errors retain their native constructor, stack, and mutable object identity. */
      const original = new RangeError('callback failed')
      /**
       * The same factory disposal boundary is exercised after valid cleanup, never by skipping
       * next.
       */
      const host = defineHost({
        host: { execution },
        dispose: async (next) => {
          const result = await next()
          if (kind === 'dispose') throw original
          return result
        }
      })
      await host.use(
        definePlugin({
          name: 'config',
          config: { value: 1 },
          install: () => ({}),
          update: () => {
            if (kind === 'update') throw original
          }
        })
      )
      /**
       * Failed configuration never commits its patch; disposal adopts one already-published
       * Promise.
       */
      const pending =
        kind === 'dispose'
          ? host.dispose()
          : host.config.update('config', () => {
              if (kind === 'recipe') throw original
              return { value: 2 }
            })
      const failure = await pending.catch((error: unknown) => error)
      expect(failure).toBe(original)
      expect(failure).toMatchObject({ source: 'plugin.host', code: 'CALLBACK_FAILED' })
      if (kind !== 'dispose') {
        expect(host.config.get('config')).toEqual({ value: 1 })
        await host.dispose()
      } else expect(host.dispose()).toBe(pending)
    }
  )

  it.each(['primitive', 'frozen'] as const)(
    'retains a %s callback cause when identity cannot attach in place',
    async (kind) => {
      /** Both JavaScript throw values and immutable Errors are valid failure payloads. */
      const original =
        kind === 'primitive' ? undefined : Object.freeze(new Error('immutable callback failed'))
      /** Recipe execution is the public boundary under audit. */
      const host = defineHost({ host: { execution } })
      await host.use(definePlugin({ name: 'config', config: { value: 1 }, install: () => ({}) }))
      /** The coded shell must preserve even an explicit undefined cause. */
      const failure = await host.config
        .update('config', () => {
          throw original
        })
        .catch((error: unknown) => error)
      expect(failure).toMatchObject({ source: 'plugin.host', code: 'CALLBACK_FAILED' })
      expect(Object.hasOwn(failure as object, 'cause')).toBe(true)
      expect((failure as Error).cause).toBe(original)
      await host.dispose()
    }
  )
  it('reports the original rejection of an async install refused by useSync', async () => {
    /** The rejected installation is invalid for sync admission but its failure still has an owner. */
    const original = new Error('async install rejected')
    const errors: unknown[] = []
    /** Existing diagnostics provide the observation path without admitting the async installation. */
    const host = defineHost({
      host: {
        execution,
        diagnostic: (_message, _code, error) => {
          if (error !== undefined) errors.push(error)
        }
      }
    })
    /** Synchronous admission keeps its existing failure chain. */
    let failure: unknown
    try {
      host.useSync(
        definePlugin({
          name: 'async-install',
          install: async () => {
            throw original
          }
        })
      )
    } catch (error) {
      failure = error
    }
    await host.dispose()
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: { code: 'INSTALL_RESULT_THENABLE' }
    })
    expect(errors).toContain(original)
  })

  it('reports incomplete pipeline drain while continuing the documented bounded removal', async () => {
    /** Only the caller can release this in-memory stage. */
    const gate = deferred<void>()
    let cleaned = 0
    let done = 0
    let completed = false
    const diagnostics: string[] = []
    /** Zero budget explicitly stops waiting; it must not claim the pending work drained. */
    const host = defineHost<object, string>({
      host: {
        execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: 0 },
        pipeline: { mode: 'async' },
        diagnostic: (_message, code) => {
          if (code) diagnostics.push(code)
        }
      }
    })
    await host.use(
      definePlugin({
        name: 'held',
        install: (core) => {
          core.useAsyncPipeline(async (value, next) => {
            await gate.promise
            await next(value)
          })
          core.onDispose(() => {
            cleaned++
          })
          return {}
        }
      })
    )
    /** The public pipeline Promise remains independently observable after logical removal. */
    const running = Promise.resolve(
      host.runPipeline('value', () => {
        done++
      })
    ).finally(() => {
      completed = true
    })
    try {
      const removal = await host.unUse('held')
      expect(removal).toMatchObject({ ok: false, errors: [{ code: 'PIPELINE_DRAIN_TIMEOUT' }] })
      expect(diagnostics).toContain('PIPELINE_DRAIN_TIMEOUT')
      expect(cleaned).toBe(1)
      expect(completed).toBe(false)
      expect(done).toBe(0)
    } finally {
      gate.resolve(undefined)
      await running
      await host.dispose()
    }
    expect(done).toBe(1)
    expect(cleaned).toBe(1)
  })
  it('does not grant a caller object managed provenance through a retired receiver option', async () => {
    /** A caller-owned object is an extension context, not a package-constructed Host. */
    const ordinary = {}
    // @ts-expect-error Receiver aliasing is not a public provenance registration path.
    const host = defineHost({ host: { execution }, receiver: ordinary })
    expect(composition.isManagedHost(host)).toBe(true)
    expect(composition.isManagedHost(ordinary)).toBe(false)
    await host.dispose()
  })
})
