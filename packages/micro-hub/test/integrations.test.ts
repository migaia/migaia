import { memoryStorageHost } from '@migaia/storage-web/memory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMicroHub, defineContract, getMicroHub, keyed, resource } from '../src/index.js'
import { persist, type IPersistOptions } from '../src/persist/index.js'
import { resources } from '../src/resource/index.js'
import { state } from '../src/state/index.js'

/** Tears down app-owned persistence/resource attachments and resets deterministic timers. */
afterEach(async () => {
  vi.useRealTimers()
  try {
    await getMicroHub().dispose()
  } catch (error) {
    if ((error as { code?: string }).code !== 'HUB_NOT_CREATED') throw error
  }
})

describe('persistence integration', () => {
  it('persists selected fields and restores them into a new hub', async () => {
    /** Backend is borrowed across two independent hub lifetimes. */
    const backend = memoryStorageHost()
    /** Only count is selected for persistence. */
    const contract = defineContract('saved', {
      version: 1,
      state: { count: 0, ephemeral: 0 },
      commands: { update: (_current, count: number, ephemeral: number) => ({ count, ephemeral }) }
    })
    /** First owner writes the storage envelope. */
    const hub = createMicroHub({ plugins: [state(), persist({ store: backend })] })
    /** Exposed persistence handle supports explicit completion. */
    const owned = hub.connect('owner').own(contract, { persist: ['count'] })
    await owned.persistence!.ready
    owned.commands.update(4, 9)
    await owned.persistence!.flush()
    await hub.dispose()
    /** New hub restores the persisted field while keeping omitted initial values. */
    const restored = createMicroHub({ plugins: [persist({ store: backend }), state()] })
      .connect('owner')
      .own(contract, { persist: ['count'] })
    await restored.persistence!.ready
    expect(restored.state.count.get()).toBe(4)
    expect(restored.state.ephemeral.get()).toBe(0)
    expect(backend.sync.keys()).toEqual(['micro-hub:saved'])
  })

  it('keeps a startup write while restoring untouched fields from delayed storage', async () => {
    /** Concrete envelope predates the application mount. */
    const backend = memoryStorageHost()
    await backend.set(
      'custom:archive',
      JSON.stringify({ version: 1, state: { count: 8, label: 'saved' } })
    )
    /** Resolver controls hydration without timing assumptions. */
    let resolveRead!: (value: string | null) => void
    /** Storage read remains pending until the local command commits. */
    const read = new Promise<string | null>((resolve) => {
      resolveRead = resolve
    })
    /** Minimal borrowed storage facade delays only the first read. */
    const delayed: IPersistOptions['store'] = {
      capabilities: backend.capabilities,
      get: () => read,
      set: (key, value, context) => backend.set(key, value, context),
      remove: (key, context) => backend.remove(key, context),
      keys: (context) => backend.keys(context)
    }
    /** Two fields demonstrate current-first hydration at field granularity. */
    const contract = defineContract('hydrate', {
      version: 1,
      state: { count: 0, label: 'initial' },
      commands: { set: (_current, count: number) => ({ count }) }
    })
    /** Owner writes before the delayed hydration completes. */
    const owned = createMicroHub({
      plugins: [state(), persist({ store: delayed, keyPrefix: 'custom:' })]
    })
      .connect('owner')
      .own(contract, { persist: ['count', 'label'], persistKey: 'archive' })
    owned.commands.set(3)
    resolveRead(backend.sync.get('custom:archive'))
    await owned.persistence!.ready
    expect(owned.state.count.get()).toBe(3)
    expect(owned.state.label.get()).toBe('saved')
    await owned.persistence!.flush()
  })

  it('discards an archive of another contract version', async () => {
    /** Existing archive represents a prior major contract. */
    const backend = memoryStorageHost()
    await backend.set('micro-hub:versioned', JSON.stringify({ version: 1, state: { count: 9 } }))
    /** Current major starts from its own field values. */
    const contract = defineContract('versioned', { version: 2, state: { count: 1 } })
    /** Hydration migrates the old shape to an empty patch. */
    const owned = createMicroHub({ plugins: [state(), persist({ store: backend })] })
      .connect('owner')
      .own(contract, { persist: ['count'] })
    await owned.persistence!.ready
    expect(owned.state.count.get()).toBe(1)
  })

  it('validates persisted fields before attaching storage and permits retry after rollback', async () => {
    /** Backend is not touched when the requested state field is invalid. */
    const backend = memoryStorageHost()
    /** State includes a keyed field that this persistence facade does not support. */
    const contract = defineContract('invalidpersist', {
      version: 1,
      state: { count: 0, entities: keyed<number>() }
    })
    /** App survives a failed own attempt. */
    const app = createMicroHub({ plugins: [state(), persist({ store: backend })] }).connect('owner')
    expect(() => app.own(contract, { persist: ['missing' as never] })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    expect(() => app.own(contract, { persist: ['entities' as never] })).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    /** Empty selection creates no attachment. */
    const unpersisted = app.own(contract)
    expect(unpersisted.persistence).toBeUndefined()
    unpersisted.release()
    /** Corrected options acquire the same contract after both rollbacks. */
    const owned = app.own(contract, { persist: ['count'] })
    await owned.persistence!.ready
    owned.release()
    expect(owned.persistence!.disposed).toBe(true)
  })

  it('stops scheduled writes at ownership release and flushes the pending debounce snapshot', async () => {
    vi.useFakeTimers()
    /** Backend exposes final storage data without adding timing delays. */
    const backend = memoryStorageHost()
    /** Count updates drive the debounced attachment. */
    const contract = defineContract('debounced', {
      version: 1,
      state: { count: 0 },
      commands: { set: (_current, count: number) => ({ count }) }
    })
    /** Owner holds the attachment that is released before the timer fires. */
    const owned = createMicroHub({
      plugins: [state(), persist({ store: backend, debounceMs: 50 })]
    })
      .connect('owner')
      .own(contract, { persist: ['count'] })
    await owned.persistence!.ready
    owned.commands.set(5)
    expect(backend.sync.get('micro-hub:debounced')).toBeNull()
    owned.release()
    await vi.runAllTimersAsync()
    expect(owned.persistence!.disposed).toBe(true)
    expect(backend.sync.get('micro-hub:debounced')).toContain('5')
  })

  it.each([{ ending: 'hub.dispose()' }, { ending: 'owned.release()' }])(
    'keeps a commit made right before $ending without debounce',
    async ({ ending }) => {
      /** Backend is borrowed by the ending hub and by the hub that restores from it. */
      const backend = memoryStorageHost()
      /** Count updates are written without a debounce window. */
      const contract = defineContract('immediate', {
        version: 1,
        state: { count: 0 },
        commands: { set: (_current, count: number) => ({ count }) }
      })
      /** First hub ends in the same task as the commit. */
      const hub = createMicroHub({ plugins: [state(), persist({ store: backend })] })
      /** Owner whose only write is still queued when ownership ends. */
      const owned = hub.connect('owner').own(contract, { persist: ['count'] })
      await owned.persistence!.ready
      owned.commands.set(7)
      if (ending === 'owned.release()') owned.release()
      await hub.dispose()
      expect(backend.sync.get('micro-hub:immediate')).toContain('7')
      /** A new hub restores the value committed before the first one ended. */
      const restored = createMicroHub({ plugins: [state(), persist({ store: backend })] })
        .connect('owner')
        .own(contract, { persist: ['count'] })
      await restored.persistence!.ready
      expect(restored.state.count.get()).toBe(7)
    }
  )

  it.each([
    {
      sequence: 'pending final write',
      inFlight: false,
      failOutgoing: false,
      releaseIntermediate: false
    },
    {
      sequence: 'in-flight write followed by final write',
      inFlight: true,
      failOutgoing: false,
      releaseIntermediate: false
    },
    {
      sequence: 'failed final write',
      inFlight: false,
      failOutgoing: true,
      releaseIntermediate: false
    },
    {
      sequence: 'an intermediate owner released before readiness',
      inFlight: false,
      failOutgoing: false,
      releaseIntermediate: true
    }
  ])(
    'orders replacement-owner I/O after $sequence',
    async ({ inFlight, failOutgoing, releaseIntermediate }) => {
      /** One backend is borrowed by successive owners and the eventual fresh hub. */
      const backend = memoryStorageHost()
      /** All three lifecycle phases address this same storage envelope. */
      const storageKey = 'micro-hub:reownpersist'
      /** Calls record adapter admission order rather than only the eventual in-memory value. */
      const writes: number[] = []
      /** First hydration establishes the baseline number of storage reads. */
      const read = vi.fn<IPersistOptions['store']['get']>((key, context) =>
        backend.get(key, context)
      )
      /** Expected outgoing failure must not poison the replacement owner's write queue. */
      const outgoingFailure = new Error('outgoing persistence write failed')
      /** Expected disposal errors are observable without noisy fallback reporting. */
      const report = vi.fn()
      /** Only the old owner's selected write is held; replacement value 3 is never delayed here. */
      let blockWrites = false
      /** Confirms the old operation reached storage before ownership is replaced. */
      let markWriting!: () => void
      /** Storage-start barrier makes both old-owner sequences deterministic. */
      const writing = new Promise<void>((resolve) => {
        markWriting = resolve
      })
      /** Releases the pending adapter operation even if an assertion fails. */
      let releaseWrite!: () => void
      /** Backends may finish an already admitted write after their caller is disposed. */
      const writeGate = new Promise<void>((resolve) => {
        releaseWrite = resolve
      })
      /** Existing backend facade delays one old write while leaving all subsequent I/O observable. */
      const delayed: IPersistOptions['store'] = {
        capabilities: backend.capabilities,
        get: read,
        set: async (key, value) => {
          /** Count identifies the real application snapshot carried by this storage call. */
          const count = (JSON.parse(value) as { state: { count: number } }).state.count
          writes.push(count)
          if (blockWrites) {
            blockWrites = false
            markWriting()
            await writeGate
            if (failOutgoing) throw outgoingFailure
          }
          // Model a backend that cannot cancel an already admitted asynchronous write.
          await backend.set(key, value)
        },
        remove: (key, context) => backend.remove(key, context),
        keys: (context) => backend.keys(context)
      }
      /** Retained memory must remain authoritative while ownership changes its persistence handle. */
      const contract = defineContract('reownpersist', {
        version: 1,
        state: { count: 0 },
        commands: { set: (_current, count: number) => ({ count }) }
      })
      /** One app releases and reacquires the same retained contract. */
      const hub = createMicroHub({
        plugins: [state(), persist({ store: delayed, debounceMs: 60_000 })],
        report
      })
      /** Re-own changes persistence handles while keeping the app connected. */
      const app = hub.connect('owner')
      /** First owner creates value 1, then owes value 2 when it releases. */
      const first = app.own(contract, { persist: ['count'] })
      /** Strict flush of an in-flight old write rejects after disposal; observe it immediately. */
      let outgoingFlush: Promise<void> | undefined
      /** A short-lived middle owner must cancel readiness without losing the earlier write barrier. */
      let intermediateReady: Promise<void> | undefined
      try {
        await first.persistence!.ready
        first.commands.set(1)
        if (inFlight) {
          blockWrites = true
          outgoingFlush = expect(first.persistence!.flush()).rejects.toMatchObject({
            code: 'ABORTED_BY_DISPOSE'
          })
          await writing
        } else {
          await first.persistence!.flush()
          blockWrites = true
        }
        first.commands.set(2)
        // Let the existing field subscription schedule its pending debounce before releasing it.
        await Promise.resolve()
        first.release()
        if (!inFlight) await writing
        if (releaseIntermediate) {
          /** This owner never reaches storage before it gives up ownership to the final replacement. */
          const intermediate = app.own(contract, { persist: ['count'] })
          intermediateReady = expect(intermediate.persistence!.ready).rejects.toMatchObject({
            code: 'ABORTED_BY_DISPOSE'
          })
          intermediate.release()
        }
        /**
         * Replacement readiness may wait for disposal completion, so do not await it before opening
         * the gate.
         */
        const replacement = app.own(contract, { persist: ['count'] })
        expect(replacement.state.count.get()).toBe(2)
        replacement.commands.set(3)
        /** Explicit flush starts while the previous handle still owns unfinished storage work. */
        const replacementFlush = replacement.persistence!.flush()
        // A fresh task drains all already-runnable Promise work without resolving the old write gate.
        await new Promise<void>((resolve) => setTimeout(resolve, 0))
        expect(read).toHaveBeenCalledTimes(1)
        expect(writes).toEqual(inFlight ? [1] : [1, 2])
        releaseWrite()
        await outgoingFlush
        await intermediateReady
        await replacement.persistence!.ready
        await replacementFlush
        expect(replacement.state.count.get()).toBe(3)
        expect(writes).toEqual([1, 2, 3])
        expect(JSON.parse(backend.sync.get(storageKey)!)).toMatchObject({ state: { count: 3 } })
        await hub.dispose()
        /** Fresh startup proves the final persisted value, beyond the original hub's retained atoms. */
        const restored = createMicroHub({
          plugins: [state(), persist({ store: delayed })],
          report
        })
          .connect('restored')
          .own(contract, { persist: ['count'] })
        await restored.persistence!.ready
        expect(restored.state.count.get()).toBe(3)
        if (failOutgoing) expect(report).toHaveBeenCalled()
      } finally {
        releaseWrite()
        await outgoingFlush
        await intermediateReady
      }
    }
  )
})

describe('shared resources integration', () => {
  it('deduplicates concurrent reads across apps and returns cached success snapshots', async () => {
    /** Shared resource declaration without state capability. */
    const contract = defineContract('shared', {
      version: 1,
      resources: { value: resource<number>() }
    })
    /** One resource plugin serves every connected app. */
    const hub = createMicroHub({ plugins: [resources()] })
    /** Resolver holds the single shared fetch open. */
    let resolve!: (value: number) => void
    /** Fetcher count distinguishes deduplication from equal results. */
    const fetcher = vi.fn(
      () =>
        new Promise<number>((done) => {
          resolve = done
        })
    )
    hub.connect('owner').own(contract).provide('value', fetcher)
    /** Independent app views resolve to the same underlying request. */
    const first = hub.connect('first').use(contract).resources.value
    /** Second consumer joins the same request. */
    const second = hub.connect('second').use(contract).resources.value
    expect(first.state.get()).toMatchObject({ status: 'idle' })
    expect(first.state.get()).toBe(first.state.get())
    /** First read starts work synchronously. */
    const pending = first.read()
    expect(second.read()).toBe(pending)
    expect(fetcher).toHaveBeenCalledOnce()
    resolve(42)
    await expect(pending).resolves.toBe(42)
    await expect(first.read()).resolves.toBe(42)
    expect(fetcher).toHaveBeenCalledOnce()
    expect(first.state.get()).toEqual({ status: 'success', data: 42, error: undefined })
    expect(first.state.get()).toBe(second.state.get())
  })

  it('exposes idle without an owner and rejects an explicit read', async () => {
    /** No owner provides this declared resource. */
    const contract = defineContract('unprovided', {
      version: 1,
      resources: { value: resource<number>() }
    })
    /** Consumer sees an idle placeholder until ownership supplies a provider. */
    const view = createMicroHub({ plugins: [resources()] })
      .connect('caller')
      .use(contract).resources.value
    expect(view.state.get()).toEqual({ status: 'idle', data: undefined, error: undefined })
    await expect(view.read()).rejects.toMatchObject({ code: 'OWNER_ABSENT' })
    expect(() => view.refetch()).not.toThrow()
  })

  it('starts observing a late provider and releases notifications when the app disconnects', async () => {
    /** Consumer subscribes before the owner provides the resource. */
    const contract = defineContract('observed', {
      version: 1,
      resources: { value: resource<number>() }
    })
    /** Shared runtime is owned by the resource capability. */
    const hub = createMicroHub({ plugins: [resources()] })
    /** App lifetime owns the resource state subscription. */
    const caller = hub.connect('caller')
    /** Consumer reads the committed resource state in each callback. */
    const view = caller.use(contract).resources.value
    /** State sequence proves late provider and fetch updates reach the subscriber. */
    const states: string[] = []
    /** Explicit unsubscribe remains idempotent after app disconnect. */
    const stop = view.state.subscribe(() => states.push(view.state.get().status))
    /** Owner can provide after observation began. */
    const owned = hub.connect('owner').own(contract)
    owned.provide('value', async () => 7)
    await expect(view.read()).resolves.toBe(7)
    expect(states).toContain('success')
    await caller.disconnect()
    /** No callbacks remain when the provider leaves. */
    const before = states.length
    owned.release()
    expect(states).toHaveLength(before)
    stop()
    stop()
    expect(() => view.state.subscribe(() => undefined)).toThrow(
      expect.objectContaining({ code: 'APP_DISCONNECTED' })
    )
    expect(() => view.state.get()).toThrow(expect.objectContaining({ code: 'APP_DISCONNECTED' }))
    expect(() => view.read()).toThrow(expect.objectContaining({ code: 'APP_DISCONNECTED' }))
    expect(() => view.refetch()).toThrow(expect.objectContaining({ code: 'APP_DISCONNECTED' }))
  })

  it('validates provider names and permits replacement after explicit unregistration', async () => {
    /** Only value is an admitted resource name. */
    const contract = defineContract('providers', {
      version: 1,
      resources: { value: resource<number>() }
    })
    /** Owner has the only provider registration surface. */
    const owned = createMicroHub({ plugins: [resources()] })
      .connect('owner')
      .own(contract)
    expect(() => owned.provide('missing' as never, async () => 1)).toThrow(
      expect.objectContaining({ code: 'INVALID_OPTION' })
    )
    /** Explicit unregistration releases the duplicate-name guard. */
    const stop = owned.provide('value', async () => 1)
    expect(() => owned.provide('value', async () => 2)).toThrow(
      expect.objectContaining({ code: 'HANDLER_DUPLICATED' })
    )
    stop()
    stop()
    owned.provide('value', async () => 2)
    await expect(owned.resources.value.read()).resolves.toBe(2)
  })

  it('keeps failed snapshots observable and reports fire-and-forget refetch failures', async () => {
    /** Reporter observes explicit void refetch failures. */
    const report = vi.fn()
    /** Original fetch failure remains reachable through the resource error contract. */
    const failure = new Error('fetch failed')
    /** Resource declaration and owner share the error state. */
    const contract = defineContract('fetcherrors', {
      version: 1,
      resources: { value: resource<number>() }
    })
    /** Owner provides a consistently failing fetcher. */
    const owned = createMicroHub({ plugins: [resources()], report })
      .connect('owner')
      .own(contract)
    owned.provide('value', async () => {
      throw failure
    })
    await expect(owned.resources.value.read()).rejects.toBe(failure)
    expect(owned.resources.value.state.get()).toMatchObject({ status: 'error', error: failure })
    owned.resources.value.refetch()
    await vi.waitFor(() => expect(report).toHaveBeenCalledWith(failure))
  })

  it('aborts an in-flight read when the provider is released and returns to idle', async () => {
    /** Owner release owns the pending request cancellation. */
    const contract = defineContract('abortresource', {
      version: 1,
      resources: { value: resource<number>() }
    })
    /** Hub holds a reader that outlives provider ownership. */
    const hub = createMicroHub({ plugins: [resources()] })
    /** Captured signal verifies cancellation reaches the fetcher. */
    let signal!: AbortSignal
    /** Owner provides a pending operation. */
    const owned = hub.connect('owner').own(contract)
    owned.provide('value', (received) => {
      signal = received
      return new Promise<number>(() => undefined)
    })
    /** Caller observes the resource disappearing without losing its contract view. */
    const view = hub.connect('caller').use(contract).resources.value
    /** Attach rejection assertion before provider disposal. */
    const rejection = expect(view.read()).rejects.toMatchObject({ name: 'AbortError' })
    owned.release()
    await rejection
    expect(signal.aborted).toBe(true)
    expect(view.state.get()).toEqual({ status: 'idle', data: undefined, error: undefined })
  })
})
