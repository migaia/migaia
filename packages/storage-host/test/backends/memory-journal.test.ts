import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { ConcurrencyPolicy } from '@migaia/storage-contract'
import {
  createStorageHost,
  createOrgId,
  memoryBackendPlugin,
  type IStorageJournalNamespaceView,
  type IStorageJournalNamespace
} from '../../src/index.js'
import { resolveStorageJournalBinding } from '../../src/journal/binding.js'

/** These cases use the actual native owner; the internal resolver is not a public KV escape hatch. */
describe('memory private journal binding', () => {
  it('binds the original default and explicit organizations while business clear leaves private rows intact', async () => {
    const defaultOrg = createOrgId()
    await using host = await createStorageHost({
      org: defaultOrg,
      plugins: [memoryBackendPlugin({ namespace: 'configured' })]
    })
    const firstOrg = host.org(createOrgId())
    const secondOrg = host.org(createOrgId())
    const targets = [host, firstOrg, secondOrg]
    const handles: IStorageJournalNamespace[] = []
    for (const [index, target] of targets.entries()) {
      const access = resolveStorageJournalBinding(target, 'memory')
      expect(access.binding).not.toHaveProperty('forOrg')
      const namespace = await access.binding.openNamespace('history')
      access.retain(namespace)
      handles.push(namespace)
      await namespace.run(async (view) => {
        await view.set('head', String(index))
        expect(await view.keys()).toEqual(['head'])
      })
      await target.backend('memory').set('business', 'value')
      await target.backend('memory').clearAll()
      expect(await target.backend('memory').keys()).toEqual([])
      expect(await namespace.run((view) => view.get('head'))).toBe(String(index))
    }
    await Promise.all(handles.map((handle) => handle.dispose()))
    await using defaultView = await resolveStorageJournalBinding(
      host.org(defaultOrg),
      'memory'
    ).binding.openNamespace('history')
    expect(await defaultView.run((view) => view.get('head'))).toBe('0')
    await host.dropOrg(firstOrg.orgId)
    await using first = await resolveStorageJournalBinding(
      firstOrg,
      'memory'
    ).binding.openNamespace('history')
    await using second = await resolveStorageJournalBinding(
      secondOrg,
      'memory'
    ).binding.openNamespace('history')
    expect(await first.run((view) => view.get('head'))).toBeNull()
    expect(await second.run((view) => view.get('head'))).toBe('2')
    expect(() => resolveStorageJournalBinding(host.backend('memory'), 'memory')).toThrowError(
      expect.objectContaining({ code: 'INVALID_ARGUMENT' })
    )
    expect(() =>
      resolveStorageJournalBinding({ backend: () => host.backend('memory') }, 'memory')
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('holds the original fixed resource lease separately from ordinary head transactions', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const access = resolveStorageJournalBinding(host, 'memory')
    const namespace = await access.binding.openNamespace('owned')
    access.retain(namespace)
    expect((await store.inspectLocks()).length).toBe(1)
    await expect(access.binding.openNamespace('owned')).rejects.toMatchObject({
      code: 'LOCK_REJECTED'
    })
    await namespace.run((view) => view.set('head', 'first'))
    expect((await store.inspectLocks()).length).toBe(1)
    await namespace.dispose()
    expect((await store.inspectLocks()).length).toBe(0)
    await using replacement = await access.binding.openNamespace('owned')
    expect(await replacement.run((view) => view.get('head'))).toBe('first')
    await store.dispose()
    await replacement.dispose()
  })

  it('publishes private rows with business data only after the original commit and leaves rollback invisible', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    await using namespace = await resolveStorageJournalBinding(
      host,
      'memory'
    ).binding.openNamespace('history')
    const prepared = deferred<void>()
    const commit = deferred<void>()
    const events: string[] = []
    const pending = store.transaction(async (scope) => {
      namespace.onCommit(scope, () => {
        events.push('commit')
      })
      namespace.onRollback(scope, () => {
        events.push('rollback')
      })
      await scope.set('business', 'committed')
      await namespace.run(async (view) => {
        await view.set('head', 'committed')
        expect(await view.has('head')).toBe(true)
      }, scope)
      let extracted: IStorageJournalNamespaceView | undefined
      await namespace.run(async (view) => {
        extracted = view
      }, scope)
      await expect(extracted!.get('head')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
      prepared.resolve()
      await commit.promise
    })
    await prepared.promise
    expect(await store.get('business')).toBeNull()
    expect(await namespace.run((view) => view.get('head'))).toBeNull()
    expect(events).toEqual([])
    commit.resolve()
    await pending
    expect(await store.get('business')).toBe('committed')
    expect(await namespace.run((view) => view.get('head'))).toBe('committed')
    expect(events).toEqual(['commit'])
    const cause = new Error('native callback rejects before commit')
    await expect(
      store.transaction(async (scope) => {
        namespace.onCommit(scope, () => {
          events.push('unexpected commit')
        })
        namespace.onRollback(scope, () => {
          events.push('rollback')
        })
        await scope.set('business', 'rolled back')
        await namespace.run((view) => view.set('head', 'rolled back'), scope)
        throw cause
      })
    ).rejects.toMatchObject({ cause })
    expect(await store.get('business')).toBe('committed')
    expect(await namespace.run((view) => view.get('head'))).toBe('committed')
    expect(events).toEqual(['commit', 'rollback'])
  })

  it('uses original scope admission, optimistic conflict and complete accepted-terminal draining', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const store = host.backend('memory')
    const access = resolveStorageJournalBinding(host, 'memory')
    const namespace = await access.binding.openNamespace('history')
    access.retain(namespace)
    let escaped: IStorageJournalNamespaceView | undefined
    await namespace.run(async (view) => {
      escaped = view
      await view.set('head', 'initial')
    })
    await expect(escaped!.get('head')).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
    const other = host.org(createOrgId()).backend('memory')
    await expect(
      other.transaction((scope) => namespace.run((view) => view.set('head', 'foreign'), scope))
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    const prepared = deferred<void>()
    const commit = deferred<void>()
    const pending = store.transaction(
      async (scope) => {
        await namespace.run(async (view) => {
          expect(await view.get('head')).toBe('initial')
          await view.set('head', 'late')
        }, scope)
        prepared.resolve()
        await commit.promise
      },
      { concurrency: ConcurrencyPolicy.optimistic({ retries: 0 }) }
    )
    await prepared.promise
    await namespace.run((view) => view.set('head', 'winner'))
    let drained = false
    const disposal = namespace.dispose()
    const main = disposal.then(() => {
      drained = true
    })
    expect(namespace.dispose()).toBe(disposal)
    const symbolic = namespace[Symbol.asyncDispose]()
    expect(namespace[Symbol.asyncDispose]()).toBe(symbolic)
    expect(drained).toBe(false)
    commit.resolve()
    await expect(pending).rejects.toMatchObject({ code: 'WRITE_CONFLICT' })
    await Promise.all([main, symbolic])
    expect(drained).toBe(true)
    await expect(namespace.run((view) => view.get('head'))).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await using reopened = await access.binding.openNamespace('history')
    expect(await reopened.run((view) => view.get('head'))).toBe('winner')
    const closing = await access.binding.openNamespace('closing')
    access.retain(closing)
    const admitted = deferred<void>()
    const release = deferred<void>()
    const work = closing.run(async (view) => {
      await view.set('head', 'pending')
      admitted.resolve()
      await release.promise
    })
    await admitted.promise
    let closed = false
    const closedHost = host.dispose().then(() => {
      closed = true
    })
    expect(closed).toBe(false)
    release.resolve()
    await expect(work).resolves.toBeUndefined()
    await closedHost
    expect(closed).toBe(true)
    expect(() => resolveStorageJournalBinding(host, 'memory')).toThrowError(
      expect.objectContaining({ code: 'STORAGE_HOST_DISPOSED' })
    )
  })

  it('reports terminal listener failures without changing the actual data result', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    await using namespace = await resolveStorageJournalBinding(
      host,
      'memory'
    ).binding.openNamespace('history')
    const cause = new Error('late terminal listener rejected')
    const diagnostics: unknown[][] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      diagnostics.push(args)
    })
    try {
      await host.backend('memory').transaction(async (scope) => {
        namespace.onCommit(scope, () => Promise.reject(cause))
        await namespace.run((view) => view.set('head', 'committed'), scope)
      })
      expect(await namespace.run((view) => view.get('head'))).toBe('committed')
      await vi.waitFor(() => expect(diagnostics).toHaveLength(1))
      expect(diagnostics[0]?.[1]).toBe(cause)
      const result = Object.freeze({ committed: true })
      await expect(
        namespace.runCommitted!(
          async (view) => {
            await view.set('head', 'terminal publication')
            return result
          },
          (value) => {
            expect(value).toBe(result)
            return Promise.reject(cause)
          }
        )
      ).resolves.toBe(result)
      await vi.waitFor(() => expect(diagnostics).toHaveLength(2))
      expect(diagnostics[1]?.[1]).toBe(cause)
      expect(await namespace.run((view) => view.get('head'))).toBe('terminal publication')
    } finally {
      consoleError.mockRestore()
    }
  })
})
