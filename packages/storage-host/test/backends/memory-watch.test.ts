import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import {
  asChangeFeedStore,
  records,
  vector,
  rdf,
  term,
  type IStorageChange
} from '@migaia/storage-contract'
import { createOrgId, createStorageHost, memoryBackendPlugin } from '../../src/index.js'
import { createBackendChangeController } from '../../src/core/change-controller.js'
import { createBackendChangeIterator } from '../../src/authoring/backend.js'

/** Native watch streams are invalidation hints from the same original commit controller. */
describe('memory native text watch', () => {
  it('reports late observer rejection once while preserving root and organization commits', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const root = host.backend('memory')
    const org = host.org(createOrgId()).backend('memory')
    const failures = [
      new Error('root observer rejected'),
      new Error('organization observer rejected')
    ]
    const diagnostics: unknown[][] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args)
    })
    try {
      for (const [index, store] of [root, org].entries()) {
        const off = store.subscribeChanges(() => Promise.reject(failures[index]))
        await expect(store.set('committed', 'value')).resolves.toBeUndefined()
        await expect(store.get('committed')).resolves.toBe('value')
        await vi.waitFor(() => expect(diagnostics).toHaveLength(index + 1))
        expect(diagnostics[index]?.[1]).toBe(failures[index])
        off()
      }
    } finally {
      consoleError.mockRestore()
    }
  })

  it('exposes genuine text watch and coalesces only unconsumed matching invalidations', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    expect(asChangeFeedStore(store)).toBe(store)
    const events: IStorageChange[] = []
    store.subscribeChanges((change) => events.push(change))
    await using stream = store.watch('watched')
    await store.set('ignored', 'x')
    await store.set('watched', 'first')
    await store.set('watched', 'second')
    const coalesced = await stream.next()
    expect(coalesced).toEqual({
      done: false,
      value: { ...events[2], channel: 'all', keys: undefined, scope: undefined }
    })
    const next = stream.next()
    await store.set('watched', 'third')
    expect(await next).toEqual({ done: false, value: events[3] })
    const cleared = stream.next()
    await store.clearValues()
    expect(await cleared).toMatchObject({ done: false, value: { channel: 'value', kind: 'clear' } })
  })

  it('keeps root watch on the default organization while original root observers retain all organizations', async () => {
    const org = createOrgId()
    const defaultOrg = createOrgId()
    await using host = await createStorageHost({
      org: defaultOrg,
      plugins: [memoryBackendPlugin()]
    })
    const root = host.backend('memory')
    const other = host.org(org).backend('memory')
    const events: IStorageChange[] = []
    root.subscribeChanges((change) => events.push(change))
    await using rootWatch = root.watch('same')
    await using otherWatch = other.watch('same')
    let rootResolved = false
    const pending = rootWatch.next().then((result) => {
      rootResolved = true
      return result
    })
    const changed = otherWatch.next()
    await other.set('same', 'other')
    expect(await changed).toMatchObject({ value: { orgId: org } })
    expect(rootResolved).toBe(false)
    await root.set('same', 'default')
    expect(await pending).toMatchObject({ value: { orgId: defaultOrg } })
    expect(events.map((event) => event.orgId)).toEqual([org, defaultOrg])
  })

  it('binds all three native query watches and rejects client predicates before subscribing', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const feed = asChangeFeedStore(store)
    await using recordWatch = feed.use(records).query().watch()
    const recordNext = recordWatch.next()
    await store.putRecord({ active: true }, 'record')
    expect(await recordNext).toMatchObject({ value: { channel: 'record', kind: 'put' } })
    const collection = feed.use(vector).collection('points', { dimensions: 1, metric: 'dot' })
    await using vectorWatch = collection.near([1]).topK(1).watch()
    const vectorNext = vectorWatch.next()
    await collection.upsert([{ id: 'one', vector: [1] }])
    expect(await vectorNext).toMatchObject({ value: { channel: 'all', kind: 'batch' } })
    await using rdfWatch = feed.use(rdf).match({}).watch()
    const rdfNext = rdfWatch.next()
    await store.use(rdf).add([
      {
        subject: term.iri('urn:a'),
        predicate: term.iri('urn:knows'),
        object: term.iri('urn:b'),
        graph: term.defaultGraph
      }
    ])
    expect(await rdfNext).toMatchObject({ value: { channel: 'all', kind: 'batch' } })
    expect(() =>
      feed
        .use(records)
        .query()
        .where(() => true)
        .watch()
    ).toThrowError(expect.objectContaining({ code: 'QUERY_NOT_PUSHABLE' }))
  })

  it('wakes concurrent pending next calls on disposal and preserves main and symbolic promise identities', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const stream = host.backend('memory').watch('same')
    const first = stream.next()
    const second = stream.next()
    const main = stream.dispose()
    expect(stream.dispose()).toBe(main)
    const symbolic = stream[Symbol.asyncDispose]()
    expect(stream[Symbol.asyncDispose]()).toBe(symbolic)
    expect(symbolic).not.toBe(main)
    await Promise.all([main, symbolic])
    expect(await first).toMatchObject({ done: true })
    expect(await second).toMatchObject({ done: true })
    expect(await stream.next()).toMatchObject({ done: true })
  })

  it('retains original cancellation reasons, timeout and root-close failures without leaving reads pending', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const cancellation = new AbortController()
    const reason = new Error('watch cancelled')
    const cancelled = store.watch('same', { signal: cancellation.signal })
    const pending = cancelled.next()
    cancellation.abort(reason)
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
    await cancelled.dispose()
    expect(() => store.watch('same', { timeoutMs: 0 })).toThrowError(
      expect.objectContaining({ code: 'ABORTED' })
    )
    const closing = store.watch('same')
    const closed = closing.next()
    await host.dispose()
    await expect(closed).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    await closing.dispose()
  })

  it('cleans the original subscription when supported signal installation fails during construction', async () => {
    const controller = createBackendChangeController({ backend: 'memory' })
    const subscribe = controller.subscribe
    const unsubscribe = vi.fn()
    vi.spyOn(controller, 'subscribe').mockImplementation((listener) => {
      const off = subscribe(listener)
      return () => {
        unsubscribe()
        off()
      }
    })
    const cause = new Error('signal listener failed')
    const signal = {
      aborted: false,
      reason: undefined,
      addEventListener: () => {
        throw cause
      },
      removeEventListener: () => undefined
    }
    expect(() =>
      createBackendChangeIterator(controller, {
        orgId: createOrgId(),
        channel: 'value',
        ctx: { signal }
      })
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT', cause }))
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledTimes(1))
    await controller.dispose()
  })

  it('retains cancellation while the original per-next pipeline is still admitting the native advance', async () => {
    const controller = createBackendChangeController({ backend: 'memory' })
    const admitted = deferred<void>()
    const finish = deferred<void>()
    const signal = new AbortController()
    const reason = new Error('watch pipeline cancelled')
    const stream = createBackendChangeIterator(controller, {
      orgId: createOrgId(),
      channel: 'value',
      ctx: { signal: signal.signal },
      execute: async (advance) => {
        admitted.resolve()
        await finish.promise
        return advance()
      }
    })
    const pending = stream.next()
    await admitted.promise
    signal.abort(reason)
    let disposed = false
    const disposal = stream.dispose().then(() => {
      disposed = true
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(disposed).toBe(false)
    finish.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED', cause: reason })
    await disposal
    expect(disposed).toBe(true)
    await controller.dispose()

    const original = new Error('native watch pipeline threw')
    const other = createBackendChangeController({ backend: 'memory' })
    const failed = createBackendChangeIterator(other, {
      orgId: createOrgId(),
      channel: 'value',
      execute: () => {
        throw original
      }
    })
    let rejection: Promise<IteratorResult<IStorageChange>> | undefined
    expect(() => {
      rejection = failed.next()
    }).not.toThrow()
    await expect(rejection).rejects.toBe(original)
    await failed.dispose()
    await other.dispose()
  })
})
