import { describe, expect, it, vi } from 'vitest'
import { createRuntime } from '../src/index.ts'
import {
  createSourceBinding,
  createTrackedObserver,
  type IObserver,
  type IObservable,
  type IRuntimeSourceBinding,
  type ITrackedObserverBinding
} from '../src/entry/extension.ts'

describe('audited reactive boundary contracts', () => {
  it.each(['native', 'getter'] as const)(
    'preserves a thrown %s Suspense object without probing its then getter',
    (kind) => {
      /** Suspense objects are control values whose consuming owner performs thenable admission. */
      const wakeup = Promise.resolve()
      /** Getter inspection belongs to the Resource/Suspense consumer and must remain single-read. */
      let reads = 0
      /**
       * Both native and structural thenables retain the original object identity through
       * derivations.
       */
      const control =
        kind === 'native'
          ? wakeup
          : // oxlint-disable-next-line unicorn/no-thenable -- Models a Suspense getter that this callback boundary must leave unread.
            Object.defineProperty({}, 'then', {
              get: () => {
                reads++
                return wakeup.then
              }
            })
      /** Each runtime callback can relay a Resource.read() suspension to its caller. */
      const runtime = createRuntime()
      for (const run of [
        () =>
          runtime.batch(() => {
            throw control
          }),
        () =>
          runtime.untracked(() => {
            throw control
          }),
        () =>
          runtime.runTracedAction('suspend', () => {
            throw control
          }),
        () =>
          runtime.computed(() => {
            throw control
          }).value
      ]) {
        /** Compare identity without asking a matcher to inspect the hostile control object's fields. */
        let caught: unknown
        try {
          run()
        } catch (error) {
          caught = error
        }
        expect(caught === control).toBe(true)
      }
      expect(reads).toBe(0)
    }
  )
  it('gives duplicate callback registrations independent removal ownership', () => {
    /** Function identity does not identify the caller that owns a hook registration. */
    const hook = vi.fn()
    /** Ordinary observation transitions drive both hook directions. */
    const runtime = createRuntime()
    /** Same hook is intentionally registered by two independent owners. */
    const signal = runtime.signal(1)
    /** Removing the first group must leave the second group active. */
    const removeA = signal.addObservedHooks({ onObserved: hook, onUnobserved: hook })
    /** The second registration retains its own lifetime. */
    const removeB = signal.addObservedHooks({ onObserved: hook, onUnobserved: hook })
    removeA()
    /** This creates and then removes the first real observation edge. */
    const effect = runtime.effect(() => {
      void signal.value
    })
    effect.dispose()
    expect(hook).toHaveBeenCalledTimes(2)
    removeB()
    signal.dispose()
  })

  it('reports deferred custom-observer task failure through canonical cleanup', () => {
    /** Schedule first and execute later, so catching only registration cannot pass. */
    const idle: (() => void)[] = []
    /** Existing runtime reporter owns the task failure. */
    const reports: unknown[] = []
    /** Each custom observer uses the admitted runtime idle channel. */
    const runtime = createRuntime({
      scheduleIdle: (task) => {
        idle.push(task)
      },
      onError: (error) => {
        reports.push(error)
      }
    })
    /** Binding installs canonical readonly edge views on the custom observer. */
    let binding: ITrackedObserverBinding
    /** Only the existing extension protocol is needed. */
    const observer: IObserver = {
      runtime,
      disposed: false,
      get deps() {
        return binding.deps
      },
      get depVersions() {
        return binding.depVersions
      },
      markDirty() {},
      onDependencyDisconnected() {}
    }
    binding = createTrackedObserver(observer)
    /** Failure must reach the configured sink after task execution. */
    const failure = new Error('idle task failed')
    binding.deferIdle(() => {
      throw failure
    })
    expect(() => idle.shift()?.()).not.toThrow()
    expect(reports).toContain(failure)
    binding.clear()
  })

  it('never republishes an older reserved source version after a reentrant notify', () => {
    /** Public controlled sources share the same canonical publication owner. */
    const runtime = createRuntime()
    /** Controlled source metadata is supplied by the canonical extension binding. */
    let binding: IRuntimeSourceBinding
    /** Node getters expose the binding's authoritative readonly graph view. */
    const node: IObservable = {
      runtime,
      get subs() {
        return binding.subs
      },
      get version() {
        return binding.version
      }
    }
    binding = createSourceBinding(node)
    /** Public operations remain bound to this exact source. */
    const source = binding.source
    /** A committed observer proves both publications remain observable. */
    let runs = 0
    /** Effect reads only the supported source capability. */
    const effect = runtime.effect(() => {
      source.track()
      runs++
    })
    /** The inner publication is newer than the outer write's reserved version. */
    let inner = 0
    source.commit(() => {
      source.notify()
      inner = binding.version
    })
    expect(binding.version).toBeGreaterThanOrEqual(inner)
    runtime.flush()
    expect(runs).toBe(2)
    effect.dispose()
    source.dispose()
  })

  it.each(['batch', 'untracked', 'action', 'computed'] as const)(
    'codes %s callback failure without replacing native identity',
    (kind) => {
      /** All four public entry points retain the same native failure and stack. */
      const failure = new RangeError('callback failed')
      /** No trace listener is needed to enter a traced action's supported fast path. */
      const runtime = createRuntime()
      /** A failing callback has no successful value. */
      const fail = (): never => {
        throw failure
      }
      /** Each invocation crosses exactly one public callback boundary. */
      const run = () =>
        kind === 'batch'
          ? runtime.batch(fail)
          : kind === 'untracked'
            ? runtime.untracked(fail)
            : kind === 'action'
              ? runtime.runTracedAction('audit', fail)
              : runtime.computed(fail).value
      expect(run).toThrow(failure)
      expect(failure).toMatchObject({ source: 'reactive', code: 'CALLBACK_FAILED' })
    }
  )

  it.each(['sync', 'async'] as const)(
    'reports %s reporter failure through the shared host queue',
    async (kind) => {
      /** Terminal callbacks stay outside the graph operation and remain observable. */
      const callbacks: (() => void)[] = []
      /** Capture the existing utils terminal channel without crashing the test host. */
      const queue = vi.spyOn(globalThis, 'queueMicrotask').mockImplementation((callback) => {
        callbacks.push(callback)
      })
      /** Reporter secondary is distinct from the operation's primary diagnostic. */
      const failure = new Error('reporter failed')
      try {
        /** A configured terminal sink must not silently discard its own failure. */
        const runtime = createRuntime({
          onError: () => {
            if (kind === 'async') return Promise.reject(failure)
            throw failure
          }
        })
        expect(() =>
          runtime.reportError(new Error('primary'), { phase: 'async-flush' })
        ).not.toThrow()
        for (let turn = 0; turn < 8; turn++) await Promise.resolve()
        expect(callbacks).toHaveLength(1)
        expect(callbacks[0]).toThrow(failure)
      } finally {
        queue.mockRestore()
      }
    }
  )

  it('brands normal nodes for a foreign copy ownership check', () => {
    /** Canonical node construction is the cross-copy diagnostic brand's owning entry. */
    const signal = createRuntime().signal(1)
    expect(
      typeof Object.getOwnPropertyDescriptor(signal, Symbol.for('@migaia/reactive.ownership-copy'))
        ?.value
    ).toBe('symbol')
    signal.dispose()
  })
})
