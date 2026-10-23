// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { act, createElement, Suspense, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import { createRuntime, type IRuntime } from '@migaia/reactive'
import { atomDef } from '@migaia/store-keyed/atom/definition'
import { Resource } from '@migaia/resource'
import { createStore } from '@migaia/store-light'
import {
  createStoreRegistry,
  StoreProvider,
  useAsyncAtomValue,
  useAtom,
  useAtomDefinition,
  useNodeValue,
  useResourceValue,
  useSetAtomDefinition,
  useSignal,
  useStore,
  useTracked
} from '../src/index.js'

/** React's public act environment switch applies only during these DOM tests. */
type IActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
/** The test owns the root and removes its subscriptions after every case. */
let root: Root
/** Each case receives an isolated browser container. */
let container: HTMLDivElement
/** Restore any act setting established by the surrounding runner. */
let previousActEnvironment: boolean | undefined

beforeEach(() => {
  previousActEnvironment = (globalThis as IActGlobal).IS_REACT_ACT_ENVIRONMENT
  ;(globalThis as IActGlobal).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  ;(globalThis as IActGlobal).IS_REACT_ACT_ENVIRONMENT = previousActEnvironment
})

/** Flush React's public render and commit phases before observing application output. */
async function render(children: ReactNode): Promise<void> {
  await act(async () => root.render(children))
}

describe('public React subscriptions', () => {
  it('reads, writes and replaces signals while releasing the previous subscription', async () => {
    /** Both nodes share the supported Runtime ownership boundary. */
    const runtime = createRuntime()
    /** The first node is replaced without remounting its component. */
    const first = runtime.signal(1)
    /** A new node must own both the visible value and setter after replacement. */
    const second = runtime.signal(8)
    /** Application callbacks can retain the stable writer returned by the hook. */
    let write!: (value: number) => void
    /** The selected node is the component's only reactive dependency. */
    function Consumer({ signal }: { signal: typeof first }) {
      const [value, set] = useSignal(signal)
      write = set
      return createElement('span', null, value)
    }
    await render(createElement(Consumer, { signal: first }))
    expect(container.textContent).toBe('1')
    expect(first.observed).toBe(true)
    /** A parent render must retain the callback when node identity does not change. */
    const originalWrite = write
    await render(createElement(Consumer, { signal: first }))
    expect(write).toBe(originalWrite)
    await act(async () => write(3))
    expect(container.textContent).toBe('3')
    await render(createElement(Consumer, { signal: second }))
    expect(container.textContent).toBe('8')
    expect(first.observed).toBe(false)
    await act(async () => write(9))
    expect(second.peek()).toBe(9)
    expect(first.peek()).toBe(3)
    await render(null)
    expect(second.observed).toBe(false)
    first.dispose()
    second.dispose()
  })

  it('rejects a node owned by another Runtime during the public render read', () => {
    /** A foreign node is a real ownership error, independent of React commit timing. */
    const node = createRuntime().signal(1)
    /** Components may use the public stable-node hook directly. */
    function Consumer() {
      return createElement('span', null, useNodeValue(node, createRuntime()))
    }
    expect(() => renderToString(createElement(Consumer))).toThrow(
      expect.objectContaining({ source: 'reactive', code: 'CROSS_RUNTIME' })
    )
    node.dispose()
  })

  it('moves tracked dependencies and Runtime ownership while honoring selector equality', async () => {
    /** A Runtime change creates a separate graph rather than reading through the old observer. */
    const firstRuntime = createRuntime()
    /** The new selector first changes dependencies within the same graph. */
    const first = firstRuntime.signal(1)
    /** The second dependency starts with equal parity but a distinguishable value. */
    const second = firstRuntime.signal(5)
    /** A later provider update moves the component to another graph. */
    const nextRuntime = createRuntime()
    /** This node can only be observed through its own Runtime. */
    const next = nextRuntime.signal(20)
    /** Stable readers expose selector replacement as application behavior. */
    const readFirst = () => first.value
    /** Stable readers avoid recreating closures during unrelated renders. */
    const readSecond = () => second.value
    /** The new Runtime has a reader that never touches the old graph. */
    const readNext = () => next.value
    /** The caller deliberately treats values with equal parity as unchanged. */
    const equal = (left: number, right: number) => left % 2 === right % 2
    /** Only public selector and Runtime inputs control this component. */
    function Consumer({ read, runtime }: { read: () => number; runtime: IRuntime }) {
      return createElement('span', null, useTracked(read, equal, runtime))
    }
    await render(createElement(Consumer, { read: readFirst, runtime: firstRuntime }))
    await act(async () => {
      first.value = 3
    })
    expect(container.textContent).toBe('1')
    await render(createElement(Consumer, { read: readSecond, runtime: firstRuntime }))
    expect(container.textContent).toBe('1')
    expect(first.observed).toBe(false)
    expect(second.observed).toBe(true)
    await act(async () => {
      second.value = 6
    })
    expect(container.textContent).toBe('6')
    await render(createElement(Consumer, { read: readNext, runtime: nextRuntime }))
    expect(container.textContent).toBe('20')
    expect(second.observed).toBe(false)
    await act(async () => {
      next.value = 21
    })
    expect(container.textContent).toBe('21')
    await render(null)
    expect(next.observed).toBe(false)
    first.dispose()
    second.dispose()
    next.dispose()
  })

  it('renders selected Store fields after a public batch', async () => {
    /** The real Store owns action batching and field dependency tracking. */
    const store = createStore({ count: 2, label: 'initial' })
    /** The hook subscribes only to this application's selected field. */
    function Consumer() {
      return createElement(
        'span',
        null,
        useStore(store, (state) => state.count)
      )
    }
    await render(createElement(Consumer))
    expect(container.textContent).toBe('2')
    await act(async () => {
      store.$batch((state) => {
        state.count += 2
        state.count += 3
      })
    })
    expect(container.textContent).toBe('7')
    await render(null)
    await store.$dispose()
  })

  it('uses direct atom reads and writes without requiring a Provider', async () => {
    /** A real owned node supplies the atom protocol without a separate fake graph. */
    const signal = createRuntime().signal(2)
    /** The adapter supplies only the documented writable-atom protocol. */
    const atom = Object.assign(signal, {
      read: () => signal.value,
      write: (value: number) => {
        signal.value = value
      }
    })
    /** Capture the public writer as an application event handler. */
    let write!: (value: number) => void
    /** Direct atoms stay usable outside dependency injection. */
    function Consumer() {
      const [value, set] = useAtom(atom)
      write = set
      return createElement('span', null, value)
    }
    await render(createElement(Consumer))
    expect(container.textContent).toBe('2')
    await act(async () => write(7))
    expect(container.textContent).toBe('7')
    expect(signal.peek()).toBe(7)
    await render(null)
    expect(signal.observed).toBe(false)
    signal.dispose()
  })

  it('routes definition-backed atoms through the selected Provider and isolates its state', async () => {
    /** Multiple registries may legitimately share one Runtime while retaining separate atom state. */
    const runtime = createRuntime()
    /** Definition identity is shared, but mutable value ownership is not. */
    const definition = atomDef(4)
    /** The atom's direct value differs from its Provider-scoped initial value. */
    const signal = runtime.signal(99)
    /** A public protocol bridge carries the same definition into either Provider. */
    const atom = Object.assign(signal, {
      atomDefinition: definition,
      read: () => signal.value,
      write: (value: number) => {
        signal.value = value
      }
    })
    /** The first application subtree owns its own atom state. */
    const first = createStoreRegistry(runtime)
    /** The second application subtree must retain an independent initial value. */
    const second = createStoreRegistry(runtime)
    /** Each subtree publishes its public writer for independent application actions. */
    const writers: Array<(value: number) => void> = []
    /** Protocol hooks and definition hooks must resolve to the same Provider store. */
    function Consumer({ index }: { index: number }) {
      const [value, set] = useAtom(atom)
      const definitionValue = useAtomDefinition(definition)
      const setDefinition = useSetAtomDefinition(definition)
      writers[index] = index === 0 ? set : setDefinition
      return createElement('span', null, `${value}/${definitionValue}`)
    }
    await render([
      createElement(StoreProvider, {
        key: 'first',
        registry: first,
        children: createElement(Consumer, { index: 0 })
      }),
      createElement(StoreProvider, {
        key: 'second',
        registry: second,
        children: createElement(Consumer, { index: 1 })
      })
    ])
    expect(container.textContent).toBe('4/44/4')
    expect(signal.observed).toBe(false)
    await act(async () => writers[0]!(8))
    expect(container.textContent).toBe('8/84/4')
    await act(async () => writers[1]!(11))
    expect(container.textContent).toBe('8/811/11')
    expect(signal.peek()).toBe(99)
    await render(null)
    expect(first.atomStore.isObserved(definition)).toBe(false)
    expect(second.atomStore.isObserved(definition)).toBe(false)
    await Promise.all([first.disposeAsync(), second.disposeAsync()])
    signal.dispose()
  })

  it('suspends pending asynchronous atoms and renders the resolved resource value', async () => {
    /** The real Resource owns the pending request and its canonical promise. */
    let resolve!: (value: number) => void
    /** A manually settled application request makes the visible transition deterministic. */
    const pending = new Promise<number>((done) => {
      resolve = done
    })
    /** Keep cache lifetime outside this assertion's scheduling concern. */
    const resource = new Resource(() => pending, createRuntime(), { ttl: Infinity })
    /** The async atom protocol delegates to the same Resource subscription. */
    function Consumer() {
      return createElement('span', null, useAsyncAtomValue({ resource }))
    }
    await render(
      createElement(Suspense, { fallback: 'loading', children: createElement(Consumer) })
    )
    expect(container.textContent).toBe('loading')
    await act(async () => {
      resolve(42)
      await resource.promise
    })
    expect(container.textContent).toBe('42')
    await render(null)
    expect(resource.observed).toBe(false)
    resource.dispose()
  })

  it('throws the original failed Resource error from the public render read', async () => {
    /** Application failures must keep identity through the Suspense-safe hook. */
    const original = new TypeError('application fetch failed')
    /** A settled real resource exercises the error state without private state injection. */
    const resource = new Resource(() => Promise.reject(original), createRuntime())
    await expect(resource.promise).rejects.toBe(original)
    /** Server rendering exposes the error thrown during render directly to its caller. */
    function Consumer() {
      return createElement('span', null, useResourceValue(resource))
    }
    /** Identity, rather than only the public message, proves the hook preserves this failure. */
    let thrown: unknown
    try {
      renderToString(createElement(Consumer))
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBe(original)
    resource.dispose()
  })
})
