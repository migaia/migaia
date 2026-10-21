// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Component, StrictMode, act, createElement, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createRuntime } from '@migaia/reactive'
import {
  StoreProvider,
  createStoreRegistry,
  createStoreToken,
  useAssertStoreFeature,
  useStoreConfig,
  useStoreFeature,
  useStoreRegistry,
  useStoreRuntime,
  type IStoreProviderConfig,
  type StoreRegistry
} from '../src/index.js'

/** A real React error boundary exposes failures through the root's public error callback. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  /** A failed subtree renders a visible fallback until the boundary is replaced. */
  override state = { failed: false }

  /** React calls this when a supported Provider or readiness operation rejects. */
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  /** Preserve the child tree on success and expose caught failure in the DOM. */
  override render() {
    return this.state.failed ? createElement('span', null, 'failed') : this.props.children
  }
}

/** The detached host keeps each test's React lifecycle independent. */
let container: HTMLDivElement
/** Each test owns exactly one concurrent root. */
let root: Root
/** React reports the actual failure without console interception or internal state access. */
let caught: unknown[]
/** Registries retained after a test remain the test's responsibility to dispose. */
let registries: Set<StoreRegistry>

/** Commit real DOM work and flush effects through React's public testing API. */
async function render(children: ReactNode): Promise<void> {
  await act(async () => {
    root.render(createElement(ErrorBoundary, { children }))
  })
}

/** Release passive effects before observing the registry's deferred disposal task. */
async function unmount(): Promise<void> {
  await act(async () => {
    root.unmount()
  })
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** Capture a caller-owned readiness promise without controlling Provider internals. */
function deferred() {
  /** The caller settles the real Promise used by config.ready. */
  let resolve!: () => void
  /** A failing initializer supplies its original rejection to the public barrier. */
  let reject!: (reason: unknown) => void
  /** Readiness remains pending until the test performs the corresponding application action. */
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  caught = []
  registries = new Set()
  root = createRoot(container, {
    onCaughtError(error) {
      caught.push(error)
    }
  })
})

afterEach(async () => {
  await unmount()
  for (const registry of registries) await registry.disposeAsync()
  container.remove()
  vi.unstubAllGlobals()
})

describe('StoreProvider committed registry ownership', () => {
  it('preserves an external registry by default and reads its matching runtime', async () => {
    /** Application assembly owns the external registry and its registered value. */
    const registry = createStoreRegistry()
    registries.add(registry)
    /** An actual owned registration makes accidental unmount disposal observable. */
    let disposed = 0
    registry.register(
      createStoreToken('external-owned'),
      { dispose: () => disposed++ },
      { owned: true }
    )
    /** Context hooks must return the caller's exact registry and runtime. */
    function Consumer() {
      /** Read the registry context independently of the equality assertion. */
      const activeRegistry = useStoreRegistry()
      /** Hooks always execute in the same order even when a public identity assertion fails. */
      const activeRuntime = useStoreRuntime()
      return createElement(
        'span',
        null,
        activeRegistry === registry && activeRuntime === registry.runtime ? 'same' : 'other'
      )
    }
    await render(
      createElement(StoreProvider, {
        registry,
        runtime: registry.runtime,
        children: createElement(Consumer)
      })
    )
    expect(container.textContent).toBe('same')
    await unmount()
    expect(registry.lifecycle).toBe('open')
    expect(disposed).toBe(0)
    await registry.disposeAsync()
    expect(disposed).toBe(1)
  })

  it('releases an external registry when disposeOnUnmount is explicitly true', async () => {
    /** Explicit ownership transfer includes the registry's actual owned registration. */
    const registry = createStoreRegistry()
    registries.add(registry)
    /** The callback count proves actual disposal rather than a context-only change. */
    let disposed = 0
    registry.register(
      createStoreToken('transferred'),
      { dispose: () => disposed++ },
      { owned: true }
    )
    await render(
      createElement(StoreProvider, {
        registry,
        disposeOnUnmount: true,
        children: 'mounted'
      })
    )
    expect(container.textContent).toBe('mounted')
    await unmount()
    expect(registry.lifecycle).toBe('terminal')
    expect(disposed).toBe(1)
  })

  it('keeps an internal registry usable through StrictMode and releases it after actual unmount', async () => {
    /** Only committed context values participate in this ownership assertion. */
    let registry: StoreRegistry | undefined
    /** React replays this effect; each replay must observe the same live owner. */
    function Consumer() {
      /** Public context returns the Provider-created registry. */
      const active = useStoreRegistry()
      useEffect(() => {
        registry = active
        registries.add(active)
      }, [active])
      return createElement('span', null, active.lifecycle)
    }
    await render(
      createElement(StrictMode, {
        children: createElement(StoreProvider, { children: createElement(Consumer) })
      })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe('open')
    expect(registry?.lifecycle).toBe('open')
    /** A post-probe registration proves the owner still accepts normal application work. */
    const token = createStoreToken<number>('after-strict-probe')
    registry!.register(token, 7)
    expect(registry!.require(token)).toBe(7)
    await unmount()
    expect(registry?.lifecycle).toBe('terminal')
  })

  it('switches an internal registry when runtime changes and releases the previous owner', async () => {
    /** The application selects two independent runtime scopes. */
    const firstRuntime = createRuntime()
    /** Runtime replacement is a supported Provider update. */
    const secondRuntime = createRuntime()
    /** Commit observations identify each public owner without accessing candidates or refs. */
    const observed: StoreRegistry[] = []
    /** A committed child records the registry selected for its runtime. */
    function Consumer() {
      /** This public context value is the committed resource owner. */
      const registry = useStoreRegistry()
      useEffect(() => {
        observed.push(registry)
        registries.add(registry)
      }, [registry])
      return createElement('span', null, registry.runtime === secondRuntime ? 'second' : 'first')
    }
    await render(
      createElement(StoreProvider, { runtime: firstRuntime, children: createElement(Consumer) })
    )
    expect(container.textContent).toBe('first')
    await render(
      createElement(StoreProvider, { runtime: secondRuntime, children: createElement(Consumer) })
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect(container.textContent).toBe('second')
    expect(observed).toHaveLength(2)
    expect(observed[0]!.lifecycle).toBe('terminal')
    expect(observed[1]!.runtime).toBe(secondRuntime)
    expect(observed[1]!.lifecycle).toBe('open')
    await unmount()
    expect(observed[1]!.lifecycle).toBe('terminal')
    /** Registry teardown does not claim ownership of either application-supplied runtime. */
    expect(firstRuntime.signal(1).peek()).toBe(1)
    expect(secondRuntime.signal(2).peek()).toBe(2)
  })
})

describe('StoreProvider readiness and configuration', () => {
  it('renders fallback until readiness resolves and exposes the normalized config snapshot', async () => {
    /** Application initialization controls the readiness barrier. */
    const ready = deferred()
    /** All enabled fields reach the same Provider snapshot read by its child. */
    const config: IStoreProviderConfig = {
      ready: [ready.promise],
      fallback: createElement('span', null, 'loading'),
      features: { wasm: true, experimental: { beta: true } },
      defaults: { warnAsyncActions: true }
    }
    /** A mounted child proves both barrier admission and config context propagation. */
    function Consumer() {
      /** Public config exposes normalized flags after initialization. */
      const snapshot = useStoreConfig()
      /** Feature hooks use the same normalized snapshot as the complete config hook. */
      const enabled = useStoreFeature('experimental.beta')
      useAssertStoreFeature('experimental.beta', 'Consumer')
      return createElement(
        'span',
        null,
        `${snapshot?.features.wasm}:${enabled}:${snapshot?.defaults.warnAsyncActions}`
      )
    }
    await render(createElement(StoreProvider, { config, children: createElement(Consumer) }))
    expect(container.textContent).toBe('loading')
    await act(async () => ready.resolve())
    expect(container.textContent).toBe('true:true:true')
    expect(caught).toEqual([])
  })

  it('returns optional configuration defaults outside a Provider', async () => {
    /** Optional feature reads support components shared between enhanced and plain trees. */
    function Consumer() {
      /** The public hook distinguishes an absent Provider from a normalized config. */
      const config = useStoreConfig()
      /** No Provider means this optional enhancement is disabled. */
      const enabled = useStoreFeature('experimental.beta')
      return createElement('span', null, `${config === null}:${enabled}`)
    }
    await render(createElement(Consumer))
    expect(container.textContent).toBe('true:false')
  })

  it('keeps a replacement ready generation blocked when only the previous generation resolves', async () => {
    /** The first operation remains pending when a newer initialization replaces it. */
    const previous = deferred()
    /** A fresh ready array selects an independent readiness generation. */
    const current = deferred()
    await render(
      createElement(StoreProvider, {
        config: { ready: [previous.promise], fallback: 'previous-loading' },
        children: 'previous-ready'
      })
    )
    expect(container.textContent).toBe('previous-loading')
    await render(
      createElement(StoreProvider, {
        config: { ready: [current.promise], fallback: 'current-loading' },
        children: 'current-ready'
      })
    )
    await act(async () => previous.resolve())
    expect(container.textContent).toBe('current-loading')
    await act(async () => current.resolve())
    expect(container.textContent).toBe('current-ready')
  })

  it.each(['error', 'reason'] as const)(
    'exposes a rejected %s through the React error boundary',
    async (kind) => {
      /** The application's original rejection must survive the Provider boundary. */
      const reason =
        kind === 'error' ? new TypeError('initialization failed') : { stage: 'storage' }
      /** Settlement occurs after the child first displays the pending fallback. */
      const ready = deferred()
      await render(
        createElement(StoreProvider, {
          config: { ready: [ready.promise], fallback: 'loading' },
          children: 'ready'
        })
      )
      expect(container.textContent).toBe('loading')
      await act(async () => ready.reject(reason))
      expect(container.textContent).toBe('failed')
      expect(caught).toHaveLength(1)
      if (kind === 'error') expect(caught[0]).toBe(reason)
      else
        expect(caught[0]).toMatchObject({
          source: '@migaia/store-react',
          code: 'READY_REJECTED',
          cause: reason
        })
    }
  )

  it('rejects a registry/runtime ownership mismatch before rendering children', async () => {
    /** The external registry owns a different runtime than the conflicting prop. */
    const registry = createStoreRegistry()
    registries.add(registry)
    await render(
      createElement(StoreProvider, {
        registry,
        runtime: createRuntime(),
        children: 'unreachable'
      })
    )
    expect(container.textContent).toBe('failed')
    expect(caught).toEqual([
      expect.objectContaining({ source: '@migaia/store-react', code: 'INVALID_CONFIG' })
    ])
    expect(registry.lifecycle).toBe('open')
  })

  it('preserves an application configuration getter failure as the public error cause', async () => {
    /** A user-supplied accessor can fail during the documented snapshot read. */
    const failure = new TypeError('configuration unavailable')
    /** This valid config shape carries the application's accessor rather than internal state. */
    const config: IStoreProviderConfig = {
      get features(): never {
        throw failure
      }
    }
    await render(createElement(StoreProvider, { config, children: 'unreachable' }))
    expect(container.textContent).toBe('failed')
    expect(caught).toEqual([
      expect.objectContaining({
        source: '@migaia/store-react',
        code: 'INVALID_CONFIG',
        cause: failure
      })
    ])
  })
})
