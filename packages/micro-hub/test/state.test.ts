import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MicroHubErrorCode,
  createMicroHub,
  defineContract,
  keyed,
  type IMicroHub,
  type IStatePatch
} from '../src/index.js'
import { state } from '../src/state/index.js'

/** Singleton created by the current case, always disposed before another case starts. */
let hub: IMicroHub | undefined

afterEach(async () => {
  await hub?.dispose()
  hub = undefined
})

describe('state capability', () => {
  it('retains accessor shape and isolates mutable keyed readers across command reads', () => {
    /** Saved readers remain live while each keyed access keeps its own mutable wrapper. */
    const captured: {
      readonly count: number
      readonly rows: { get(id: string): number | undefined; readonly ids: readonly string[] }
    }[] = []
    /** Command reads exercise the reused untracked accessor object. */
    const contract = defineContract('accessor-shape', {
      version: 1,
      state: { count: 0, rows: keyed<number>() },
      commands: {
        capture: (current) => {
          captured.push(current)
          return {}
        },
        put: () => ({ count: 1, rows: { a: 2 } })
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Owner uses public commands so freeze and revision semantics stay on the supported path. */
    const view = hub.connect('owner').own(contract)
    view.commands.capture()
    expect(Object.keys(captured[0]!)).toEqual(['count', 'rows'])
    expect(Object.isFrozen(captured[0])).toBe(true)
    expect(Object.getOwnPropertyDescriptor(captured[0]!, 'count')).toMatchObject({
      enumerable: true,
      configurable: false,
      get: expect.any(Function)
    })
    /** Mutating one returned wrapper cannot replace another access's reader. */
    const rows = captured[0]!.rows
    rows.get = () => 99
    expect(captured[0]!.rows).not.toBe(rows)
    view.commands.put()
    view.commands.capture()
    expect(captured[0]!.count).toBe(1)
    expect(captured[1]!.rows.get('a')).toBe(2)
    expect(captured[0]!.rows.ids).toBe(view.state.rows.ids.get())
    expect(view.revision.get()).toBe(3)
  })

  it('keeps keyed preview and tracked derivations on their own readers', async () => {
    /** Unrelated writes must not create dependencies merely by constructing accessors. */
    const computed = vi.fn((current: { rows: { get(id: string): number | undefined } }) =>
      current.rows.get('a')
    )
    /** Unobserved reads exercise store preview before a subscription commits the graph. */
    const contract = defineContract('keyed-readers', {
      version: 1,
      state: { count: 0, rows: keyed<number>() },
      computed: { row: computed },
      commands: {
        put: (_current, value: number) => ({ rows: { a: value } }),
        unrelated: () => ({ count: 1 })
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Both derivation forms first read without a live subscription. */
    const view = hub.connect('owner').own(contract)
    /** Selection readers must retain the same keyed dependency as contract computed values. */
    const selection = view.select((current) => current.rows.get('a'))
    expect(view.computed.row.get()).toBeUndefined()
    expect(selection.get()).toBeUndefined()
    /** Callbacks distinguish real keyed changes from unrelated plain-field writes. */
    const onComputed = vi.fn()
    /** Independent selection callback proves both consumers establish their own graph. */
    const onSelected = vi.fn()
    view.computed.row.subscribe(onComputed)
    selection.subscribe(onSelected)
    view.commands.put(2)
    await Promise.resolve()
    expect(view.computed.row.get()).toBe(2)
    expect(selection.get()).toBe(2)
    expect(onComputed).toHaveBeenCalledTimes(1)
    expect(onSelected).toHaveBeenCalledTimes(1)
    /** Existing computed invocation count must remain stable after an unread-field commit. */
    const calls = computed.mock.calls.length
    view.commands.unrelated()
    await Promise.resolve()
    expect(view.computed.row.get()).toBe(2)
    expect(selection.get()).toBe(2)
    expect(computed).toHaveBeenCalledTimes(calls)
    expect(onComputed).toHaveBeenCalledTimes(1)
    expect(onSelected).toHaveBeenCalledTimes(1)
  })

  it.each(['computed', 'select'] as const)(
    '%s notifies when its returned accessor changes',
    async (kind) => {
      /** Reading all fields then returning the supplied object is a valid pure derivation. */
      const snapshot = (current: { readonly count: number }) => {
        Object.values(current)
        return current
      }
      /** The accessor identity must still change when a tracked field causes recomputation. */
      const contract = defineContract('returned-accessor', {
        version: 1,
        state: { count: 0 },
        computed: { value: snapshot },
        commands: { update: () => ({ count: 1 }) }
      })
      hub = createMicroHub({ plugins: [state()] })
      /** Both public derivation entry points use the same state reader behavior. */
      const view = hub.connect('owner').own(contract)
      /** A pre-subscription preview must not become the reused tracked accessor. */
      const readable = kind === 'computed' ? view.computed.value : view.select(snapshot)
      /** Each dependency change must preserve the prior notification contract. */
      const listener = vi.fn()
      readable.subscribe(listener)
      /** The tracked accessor before the command is the identity to replace. */
      const before = readable.get()
      view.commands.update()
      await Promise.resolve()
      expect(listener).toHaveBeenCalledTimes(1)
      expect(readable.get()).not.toBe(before)
      expect(readable.get().count).toBe(1)
    }
  )

  it('clones initial objects and keeps frozen snapshots stable', () => {
    /** Caller-owned initial value must stay mutable and independent of committed state. */
    const initial = { count: 0 }
    /** Contract whose initial object is cloned on its first read. */
    const contract = defineContract('initial', { version: 1, state: { value: initial } })
    hub = createMicroHub({ plugins: [state()] })
    /** Public readable used by frameworks as a stable snapshot. */
    const value = hub.connect('reader').use(contract).state.value
    /** The same committed object is returned until a command changes it. */
    const snapshot = value.get()
    expect(snapshot).toEqual(initial)
    expect(snapshot).not.toBe(initial)
    expect(value.get()).toBe(snapshot)
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(initial)).toBe(false)
    initial.count = 99
    expect(value.get().count).toBe(0)
  })

  it('freezes command objects and arrays without copying them', () => {
    /** Command values are shared by reference after freezing their top level. */
    const contract = defineContract('freeze', {
      version: 1,
      state: { item: { count: 0 }, items: [] as number[] },
      commands: {
        replace: (_state, item: { count: number }, items: number[]) => ({ item, items })
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Owner commands and readable state share the contract's committed atoms. */
    const view = hub.connect('owner').own(contract)
    /** Fresh command payloads become the committed snapshots. */
    const item = { count: 1 }
    /** Array snapshots receive the same top-level freeze as object snapshots. */
    const items = [1, 2]
    expect(view.commands.replace(item, items)).toEqual({ revision: 1 })
    expect(view.state.item.get()).toBe(item)
    expect(view.state.items.get()).toBe(items)
    expect(Object.isFrozen(item)).toBe(true)
    expect(Object.isFrozen(items)).toBe(true)
    expect(view.state.items.get()).toBe(items)
  })

  it('commits all fields before notifying each subscriber once', async () => {
    /** Two fields change together even though each has its own subscription point. */
    const contract = defineContract('batch', {
      version: 1,
      state: { left: 0, right: 0 },
      commands: { replace: () => ({ left: 1, right: 2 }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Readable values must already be committed when either callback runs. */
    const view = hub.connect('owner').own(contract)
    /** Records snapshots seen by the first field's listener. */
    const left = vi.fn(() => [view.state.left.get(), view.state.right.get(), view.revision.get()])
    /** Records snapshots seen by the second field's listener. */
    const right = vi.fn(() => [view.state.left.get(), view.state.right.get(), view.revision.get()])
    view.state.left.subscribe(left)
    view.state.right.subscribe(right)
    view.commands.replace()
    expect(view.state.left.get()).toBe(1)
    expect(view.state.right.get()).toBe(2)
    await Promise.resolve()
    expect(left).toHaveBeenCalledTimes(1)
    expect(right).toHaveBeenCalledTimes(1)
    expect(left.mock.results[0].value).toEqual([1, 2, 1])
    expect(right.mock.results[0].value).toEqual([1, 2, 1])
  })

  it('allows only the current owner and declared writers', () => {
    /** Only the additional named writer can write without owning this contract. */
    const contract = defineContract('permissions', {
      version: 1,
      state: { count: 0 },
      writers: ['writer'],
      commands: { increment: (current) => ({ count: current.count + 1 }), empty: () => ({}) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Owner permissions come from the live ownership record. */
    const owner = hub.connect('owner').own(contract)
    /** Explicit writers can issue the same public commands. */
    const writer = hub.connect('writer').use(contract)
    /** Readers receive commands but each invocation checks its permission. */
    const reader = hub.connect('reader').use(contract)
    expect(() => reader.commands.increment()).toThrowError(
      expect.objectContaining({ code: MicroHubErrorCode.writeDenied })
    )
    expect(reader.revision.get()).toBe(0)
    expect(owner.commands.increment()).toEqual({ revision: 1 })
    expect(writer.commands.increment()).toEqual({ revision: 2 })
    expect(writer.commands.empty()).toEqual({ revision: 3 })
    expect(reader.state.count.get()).toBe(2)
    expect(reader.revision.get()).toBe(3)
  })

  it('rejects unknown patch fields before committing known fields', () => {
    /** A runtime-invalid patch must not partially commit its valid leading field. */
    const contract = defineContract('unknown-field', {
      version: 1,
      state: { count: 0 },
      commands: { invalid: () => ({ count: 1, unknown: 2 }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Reads prove both the data and its revision stay unchanged after rejection. */
    const view = hub.connect('owner').own(contract)
    expect(() => view.commands.invalid()).toThrowError(
      expect.objectContaining({ code: MicroHubErrorCode.invalidOption })
    )
    expect(view.state.count.get()).toBe(0)
    expect(view.revision.get()).toBe(0)
  })

  it.each([null, [], 1])('rejects invalid keyed patch %j before any write', (invalid) => {
    /** Keyed patches require an object mapping ids to values or undefined. */
    const contract = defineContract('invalid-keyed', {
      version: 1,
      state: { count: 0, rows: keyed<number>() },
      commands: {
        invalid: () =>
          ({ count: 1, rows: invalid }) as unknown as IStatePatch<{
            count: number
            rows: ReturnType<typeof keyed<number>>
          }>
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Both field kinds stay unchanged after the keyed input fails validation. */
    const view = hub.connect('owner').own(contract)
    expect(() => view.commands.invalid()).toThrowError(
      expect.objectContaining({ code: MicroHubErrorCode.invalidOption })
    )
    expect(view.state.count.get()).toBe(0)
    expect(view.state.rows.ids.get()).toEqual([])
    expect(view.revision.get()).toBe(0)
  })

  it('prepares all plain values before writing when a later freeze fails', async () => {
    /** Nonempty typed arrays cannot be frozen; rejection must precede the first atom write. */
    const contract = defineContract('atomic-plain', {
      version: 1,
      state: { count: 0, buffer: null as Uint8Array | null },
      commands: { invalid: () => ({ count: 1, buffer: new Uint8Array([1]) }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** The valid first field cannot become visible or emit a notification after failure. */
    const view = hub.connect('owner').own(contract)
    /** Counts updates from the field that used to be written before the freeze failed. */
    const listener = vi.fn()
    view.state.count.subscribe(listener)
    expect(() => view.commands.invalid()).toThrowError(
      expect.objectContaining({
        code: MicroHubErrorCode.invalidOption,
        cause: expect.any(TypeError)
      })
    )
    expect(view.state.count.get()).toBe(0)
    expect(view.state.buffer.get()).toBeNull()
    expect(view.revision.get()).toBe(0)
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
  })

  it('prepares every keyed entry before committing a failing keyed patch', () => {
    /** A later unfreezable entity must not commit an earlier entity or plain field. */
    const contract = defineContract('atomic-keyed', {
      version: 1,
      state: { count: 0, rows: keyed<{ count: number } | Uint8Array>() },
      commands: {
        invalid: () => ({ count: 1, rows: { good: { count: 1 }, bad: new Uint8Array([1]) } })
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Keyed readable values and membership remain consistent after rejected preparation. */
    const view = hub.connect('owner').own(contract)
    expect(() => view.commands.invalid()).toThrowError(
      expect.objectContaining({
        code: MicroHubErrorCode.invalidOption,
        cause: expect.any(TypeError)
      })
    )
    expect(view.state.count.get()).toBe(0)
    expect(view.state.rows.at('good').get()).toBeUndefined()
    expect(view.state.rows.ids.get()).toEqual([])
    expect(view.revision.get()).toBe(0)
  })

  it('rejects Promise command results without committing', async () => {
    /** Runtime enforcement also protects consumers whose command types were bypassed. */
    const contract = defineContract('async-command', {
      version: 1,
      state: { count: 0 },
      commands: { invalid: () => Promise.resolve({ count: 1 }) as unknown as { count: number } }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** The public synchronous command throws instead of returning an async commit. */
    const view = hub.connect('owner').own(contract)
    expect(() => view.commands.invalid()).toThrowError(
      expect.objectContaining({ code: MicroHubErrorCode.commandAsync })
    )
    await Promise.resolve()
    expect(view.state.count.get()).toBe(0)
    expect(view.revision.get()).toBe(0)
  })

  it('reports a rejected async command without an unhandled rejection', async () => {
    /** Original failure remains observable even though the command API rejects async results. */
    const original = new Error('async command failed')
    /** Hub reporter receives the Promise rejection rather than the host unhandled channel. */
    const report = vi.fn()
    /** Rejected async output is intentionally passed through the runtime-only admission path. */
    const contract = defineContract('rejected-command', {
      version: 1,
      state: { count: 0 },
      commands: { invalid: () => Promise.reject(original) as unknown as { count: number } }
    })
    hub = createMicroHub({ plugins: [state()], report })
    /** Command failure remains synchronous while the rejected Promise is observed separately. */
    const view = hub.connect('owner').own(contract)
    expect(() => view.commands.invalid()).toThrowError(
      expect.objectContaining({ code: MicroHubErrorCode.commandAsync })
    )
    await Promise.resolve()
    await Promise.resolve()
    expect(report).toHaveBeenCalledExactlyOnceWith(original)
    expect(view.state.count.get()).toBe(0)
    expect(view.revision.get()).toBe(0)
  })

  it('retains a throwing then getter as the async admission error cause', () => {
    /** A failed then lookup must not escape as an uncoded native failure. */
    const original = new Error('then lookup failed')
    /** An object whose async admission fails before a patch can be read. */
    const contract = defineContract('then-getter', {
      version: 1,
      state: { count: 0 },
      commands: {
        invalid: () =>
          ({
            // The fixture deliberately models failed thenable admission at the public boundary.
            // oxlint-disable-next-line unicorn/no-thenable
            get then() {
              throw original
            }
          }) as unknown as { count: number }
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Error coding preserves the original getter failure on the cause chain. */
    const view = hub.connect('owner').own(contract)
    expect(() => view.commands.invalid()).toThrowError(
      expect.objectContaining({ code: MicroHubErrorCode.commandAsync, cause: original })
    )
    expect(view.revision.get()).toBe(0)
  })

  it('computed tracks only its read fields and keeps unrelated commits from changing its snapshot', async () => {
    /** The derived value must not recompute when only an unread field changes. */
    const computed = vi.fn((current: { count: number }) => ({ count: current.count }))
    /** Independent fields let the test distinguish dependency updates from unrelated writes. */
    const contract = defineContract('computed', {
      version: 1,
      state: { count: 0, other: 0 },
      computed: { value: computed },
      commands: { other: () => ({ other: 1 }), count: () => ({ count: 1 }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Owner view drives changes through the same public command interface as applications. */
    const view = hub.connect('owner').own(contract)
    /** Stable object before the first dependency change. */
    const initial = view.computed.value.get()
    /** Subscriber remains quiet for an unrelated write. */
    const listener = vi.fn()
    view.computed.value.subscribe(listener)
    view.commands.other()
    await Promise.resolve()
    expect(view.computed.value.get()).toBe(initial)
    expect(computed).toHaveBeenCalledTimes(1)
    expect(listener).not.toHaveBeenCalled()
    view.commands.count()
    await Promise.resolve()
    expect(view.computed.value.get()).toEqual({ count: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
    expect(computed).toHaveBeenCalledTimes(2)
  })

  it('preserves equal selections and notifies changed selections once', async () => {
    /** Updating the source can retain the selected semantic result. */
    const contract = defineContract('selection', {
      version: 1,
      state: { count: 0 },
      commands: { set: (_current, count: number) => ({ count }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** A custom comparator retains the previous object while its parity is equal. */
    const view = hub.connect('owner').own(contract)
    /** Selection with an object result exercises both equality and reference stability. */
    const selection = view.select(
      (current) => ({ parity: current.count % 2 }),
      (previous, next) => previous.parity === next.parity
    )
    /** First result is reused after a source change with an equal selection. */
    const initial = selection.get()
    /** Counts only changes of the selected result. */
    const listener = vi.fn()
    selection.subscribe(listener)
    view.commands.set(2)
    await Promise.resolve()
    expect(selection.get()).toBe(initial)
    expect(listener).not.toHaveBeenCalled()
    view.commands.set(3)
    await Promise.resolve()
    expect(selection.get()).toEqual({ parity: 1 })
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it.each(['computed', 'select'] as const)(
    '%s keeps one snapshot across subscribe, unsubscribe and resubscribe with no commit',
    (kind) => {
      /** Both derivation APIs may return fresh objects while exposing stable snapshots. */
      const contract = defineContract('subscription-snapshot', {
        version: 1,
        state: { count: 0 },
        computed: { value: (current) => ({ count: current.count }) }
      })
      hub = createMicroHub({ plugins: [state()] })
      /** The same test drives contract computed values and ad-hoc selections. */
      const view = hub.connect('reader').use(contract)
      /** Readable must keep its identity even if its underlying node is released. */
      const readable =
        kind === 'computed'
          ? view.computed.value
          : view.select((current) => ({ count: current.count }))
      /** Initial result is the identity to preserve until a state commit. */
      const initial = readable.get()
      /** First observer makes the underlying derived node live. */
      const stop = readable.subscribe(vi.fn())
      expect(readable.get()).toBe(initial)
      stop()
      stop()
      expect(readable.get()).toBe(initial)
      /** A released selection can acquire a new node without changing its public snapshot. */
      const stopAgain = readable.subscribe(vi.fn())
      expect(readable.get()).toBe(initial)
      stopAgain()
      expect(readable.get()).toBe(initial)
    }
  )

  it('can retry a failed selection subscription and still unsubscribe cleanly', async () => {
    /** The first derivation fails before the subscription can be registered. */
    let failing = true
    /** Failure identity must survive subscription admission unchanged. */
    const original = new Error('selection failed')
    /** Updating the state after retry proves the failed attempt left no active listener. */
    const contract = defineContract('failed-subscription', {
      version: 1,
      state: { count: 0 },
      commands: { set: () => ({ count: 1 }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Readable is reused after the transient selector failure. */
    const view = hub.connect('owner').own(contract)
    /** Selector models an application derivation that can throw while being subscribed. */
    const selection = view.select((current) => {
      if (failing) throw original
      return { count: current.count }
    })
    expect(() => selection.subscribe(vi.fn())).toThrow(original)
    failing = false
    /** Only this successful registration may receive a later state update. */
    const listener = vi.fn()
    /** Last successful observer must be released after the failed attempt. */
    const stop = selection.subscribe(listener)
    expect(selection.get()).toEqual({ count: 0 })
    stop()
    view.commands.set()
    await Promise.resolve()
    expect(listener).not.toHaveBeenCalled()
    expect(selection.get()).toEqual({ count: 1 })
    expect(selection.get()).toBe(selection.get())
  })

  it('updates only the keyed id and changes ids only for additions or deletions', async () => {
    /** Entity values and the insertion-ordered id list have independent subscription points. */
    const contract = defineContract('keyed', {
      version: 1,
      state: { rows: keyed<{ count: number }>() },
      commands: {
        put: (_current, id: string, count: number) => ({ rows: { [id]: { count } } }),
        remove: (_current, id: string) => ({ rows: { [id]: undefined } })
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Owner commands drive additions, replacements and deletions. */
    const view = hub.connect('owner').own(contract)
    /** Entity A is observed before its first insertion. */
    const a = view.state.rows.at('a')
    /** Entity B must not notify when A changes. */
    const b = view.state.rows.at('b')
    /** Independent notification counter for A. */
    const onA = vi.fn()
    /** Independent notification counter for B. */
    const onB = vi.fn()
    /** Membership notification counter. */
    const onIds = vi.fn()
    a.subscribe(onA)
    b.subscribe(onB)
    view.state.rows.ids.subscribe(onIds)
    expect(a.get()).toBeUndefined()
    view.commands.put('a', 1)
    await Promise.resolve()
    expect(a.get()).toEqual({ count: 1 })
    expect(Object.isFrozen(a.get())).toBe(true)
    expect(view.state.rows.ids.get()).toEqual(['a'])
    expect(Object.isFrozen(view.state.rows.ids.get())).toBe(true)
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).not.toHaveBeenCalled()
    expect(onIds).toHaveBeenCalledTimes(1)
    /** Replacing an entity must retain the membership snapshot and avoid ids notification. */
    const ids = view.state.rows.ids.get()
    view.commands.put('a', 2)
    await Promise.resolve()
    expect(view.state.rows.ids.get()).toBe(ids)
    expect(onA).toHaveBeenCalledTimes(2)
    expect(onIds).toHaveBeenCalledTimes(1)
    view.commands.put('b', 3)
    await Promise.resolve()
    expect(view.state.rows.ids.get()).toEqual(['a', 'b'])
    view.commands.remove('a')
    await Promise.resolve()
    expect(a.get()).toBeUndefined()
    expect(view.state.rows.ids.get()).toEqual(['b'])
    expect(onA).toHaveBeenCalledTimes(3)
    expect(onB).toHaveBeenCalledTimes(1)
    expect(onIds).toHaveBeenCalledTimes(3)
    view.commands.remove('missing')
    await Promise.resolve()
    expect(onIds).toHaveBeenCalledTimes(3)
  })

  it('preserves keyed order and membership after a rejected multi-id patch', () => {
    /** A failing entity must leave both the committed ids and the membership index unchanged. */
    const contract = defineContract('keyed-membership', {
      version: 1,
      state: { rows: keyed<number | Uint8Array>() },
      commands: {
        patch: (_current, rows: Record<string, number | Uint8Array | undefined>) => ({ rows })
      }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** One patch may interleave replacements, insertions and deletions. */
    const view = hub.connect('owner').own(contract)
    view.commands.patch({ a: 1, b: 2, c: 3 })
    view.commands.patch({ b: undefined, d: 4, a: 9, missing: undefined })
    expect(view.state.rows.ids.get()).toEqual(['a', 'c', 'd'])
    expect(Object.isFrozen(view.state.rows.ids.get())).toBe(true)
    /** Replacements and absent deletions retain the public membership snapshot. */
    const ids = view.state.rows.ids.get()
    view.commands.patch({ a: 10, missing: undefined })
    expect(view.state.rows.ids.get()).toBe(ids)
    expect(() =>
      view.commands.patch({ a: undefined, e: 5, broken: new Uint8Array([1]) })
    ).toThrowError(
      expect.objectContaining({
        code: MicroHubErrorCode.invalidOption,
        cause: expect.any(TypeError)
      })
    )
    expect(view.state.rows.ids.get()).toBe(ids)
    expect(view.state.rows.at('a').get()).toBe(10)
    expect(view.state.rows.at('e').get()).toBeUndefined()
    view.commands.patch({ a: undefined, e: 5 })
    expect(view.state.rows.ids.get()).toEqual(['c', 'd', 'e'])
    expect(view.revision.get()).toBe(4)
  })

  it('retains state and removes old subscriptions when ownership disconnects', async () => {
    /** A new owner resumes the same contract state and revision. */
    const contract = defineContract('new-owner', {
      version: 1,
      state: { count: 0 },
      commands: { increment: (current) => ({ count: current.count + 1 }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** First app owns the state until it disconnects. */
    const app = hub.connect('first')
    /** Old view subscriptions must not survive the app. */
    const first = app.own(contract)
    /** A connected consumer keeps reading while the owner changes. */
    const reader = hub.connect('reader').use(contract)
    /** Records callbacks belonging to the app that will disconnect. */
    const listener = vi.fn()
    first.state.count.subscribe(listener)
    first.commands.increment()
    await Promise.resolve()
    expect(listener).toHaveBeenCalledTimes(1)
    await app.disconnect()
    expect(reader.state.count.get()).toBe(1)
    /** A newly connected app may claim the released ownership. */
    const next = hub.connect('next').own(contract)
    expect(next.commands.increment()).toEqual({ revision: 2 })
    await Promise.resolve()
    expect(reader.state.count.get()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('rejects reads, selections and subscriptions from a disconnected app', async () => {
    /** Every state entry point uses the same app connection guard. */
    const contract = defineContract('disconnected', {
      version: 1,
      state: { count: 0, rows: keyed<number>() },
      computed: { count: (current) => current.count },
      commands: { increment: (current) => ({ count: current.count + 1 }) }
    })
    hub = createMicroHub({ plugins: [state()] })
    /** Cached readable handles remain bound to the app that created them. */
    const app = hub.connect('owner')
    /** Owner view becomes unusable after disconnect, even while the hub stays live. */
    const view = app.own(contract)
    /** Existing selection must check connection on get and subscribe too. */
    const selection = view.select((current) => current.count)
    /** Existing keyed readable must not bypass the connection guard. */
    const row = view.state.rows.at('a')
    await app.disconnect()
    for (const invoke of [
      () => view.state.count.get(),
      () => view.state.count.subscribe(vi.fn()),
      () => view.computed.count.get(),
      () => view.computed.count.subscribe(vi.fn()),
      () => view.revision.get(),
      () => view.state.rows.at('a'),
      () => view.state.rows.ids.get(),
      () => row.get(),
      () => view.select((current) => current.count),
      () => selection.get(),
      () => selection.subscribe(vi.fn()),
      () => view.commands.increment()
    ]) {
      expect(invoke).toThrowError(
        expect.objectContaining({ code: MicroHubErrorCode.appDisconnected })
      )
    }
  })
})
