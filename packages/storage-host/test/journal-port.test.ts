import { describe, expect, it } from 'vitest'
import { deferred } from '@migaia/utils/promise'
import { lockKey, runTransactionOperation } from '@migaia/storage-contract'
import { LogRecordState } from '@migaia/logger/plugins/durable'
import {
  createStorageHost,
  createOrgId,
  definePlugin,
  memoryBackendPlugin,
  memoryBackendKind,
  type IStoragePluginCore,
  type IStorageJournalNamespaceView,
  type IStorageJournalBackendBinding
} from '../src/index.js'
import { storageLogStore } from '../src/journal.js'
import { resolveStorageLogNativeAccess } from '../src/journal/append-port.js'
import { createMemoryBackend } from '../src/backends/memory.js'

/** Delay only an ordinary result after the original owner has actually committed and freed locks. */
function delayedCommittedPlugin(delay: {
  hold: boolean
  terminal?: boolean
  entered: ReturnType<typeof deferred<void>>
  release: ReturnType<typeof deferred<void>>
}) {
  return definePlugin('data', (core: IStoragePluginCore) => {
    let constructed: ReturnType<typeof createMemoryBackend>
    const project = (binding: IStorageJournalBackendBinding): IStorageJournalBackendBinding => ({
      forOrg: (orgId) => project(binding.forOrg(orgId)),
      openNamespace: async (prefix) => {
        const namespace = await binding.openNamespace(prefix)
        return {
          ...namespace,
          run: async (work, scope) => {
            const result = await namespace.run(work, scope)
            if (scope === undefined && delay.hold) {
              delay.entered.resolve()
              await delay.release.promise
            }
            return result
          },
          runCommitted:
            delay.terminal === false
              ? undefined
              : async <R>(
                  work: (view: IStorageJournalNamespaceView) => Promise<R>,
                  committed: (value: R) => void
                ): Promise<R> => {
                  const result = await namespace.runCommitted!(work, committed)
                  if (delay.hold) {
                    delay.entered.resolve()
                    await delay.release.promise
                  }
                  return result
                }
        }
      }
    })
    return {
      kind: memoryBackendKind,
      featureExpose: () => ({
        getClient: () => undefined,
        getTransactionClient: (
          scope: Parameters<ReturnType<typeof createMemoryBackend>['assertScope']>[0]
        ) => {
          constructed.assertScope(scope)
          return undefined
        }
      }),
      capabilityInstaller: (_store: ReturnType<typeof createMemoryBackend>['store']) =>
        constructed.installer,
      journalBinding: (_store: ReturnType<typeof createMemoryBackend>['store']) =>
        project(constructed.journalBinding),
      install: () => {
        constructed = createMemoryBackend(core, {})
        core.registerStore(constructed.store)
        core.registerChangeController(constructed.store, constructed.controller)
        core.registerOrgBinding(constructed.store, constructed.orgBinding)
        return {}
      }
    }
  })
}

describe('original native log append port', () => {
  it('keeps ordinary logs usable when an older native namespace lacks the terminal publication port', async () => {
    const delay = {
      hold: false,
      terminal: false,
      entered: deferred<void>(),
      release: deferred<void>()
    }
    await using host = await createStorageHost({ plugins: [delayedCommittedPlugin(delay)] })
    await using log = await storageLogStore(host, 'data', { prefix: 'ordinary' })
    expect(await log.append([{ kind: 'ordinary', payload: null }])).toEqual([1])
    const native = resolveStorageLogNativeAccess(log)
    await host.backend('data').transaction(async (scope) => {
      expect(() => native.createPort(scope)).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
      )
    })
    expect(await log.lastSeq()).toBe(1)
  })
  it('publishes ordinary committed indexes before a waiting native owner can commit the next head', async () => {
    const delay = { hold: false, entered: deferred<void>(), release: deferred<void>() }
    await using host = await createStorageHost({ plugins: [delayedCommittedPlugin(delay)] })
    await using log = await storageLogStore(host, 'data', { prefix: 'history' })
    const native = resolveStorageLogNativeAccess(log)
    const notices: unknown[] = []
    log.onAppend((notice) => {
      notices.push(notice)
    })
    delay.hold = true
    const ordinary = log.append([{ kind: 'ordinary', payload: null }])
    await delay.entered.promise
    await host.backend('data').transaction(
      async (scope) => {
        expect(await native.createPort(scope).append([{ kind: 'native', payload: null }])).toEqual([
          2
        ])
      },
      { lock: [native.headLock] }
    )
    delay.hold = false
    delay.release.resolve()
    await ordinary
    expect(await log.lastSeq()).toBe(2)
    expect((await log.read(1, 10)).map((row) => row.kind)).toEqual(['ordinary', 'native'])
    expect(notices).toEqual([
      { lastSeq: 1, count: 1 },
      { lastSeq: 2, count: 1 }
    ])
  })

  it('shares one real attempt across fresh views, concurrent batches and one post-commit notice', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    await using log = await storageLogStore(host, 'memory', { prefix: 'history' })
    const native = resolveStorageLogNativeAccess(log)
    const prepared = deferred<void>()
    const commit = deferred<void>()
    const notices: unknown[] = []
    log.onAppend((notice) => {
      notices.push(notice)
    })
    const transaction = host.backend('memory').transaction(
      async (scope) => {
        await scope.set('business', 'committed')
        const port = native.createPort(scope)
        const batches = await Promise.all([
          port.append([
            { kind: 'one', payload: null },
            { kind: 'two', payload: null }
          ]),
          runTransactionOperation(scope, (fresh) =>
            native.createPort(fresh).append([{ kind: 'three', payload: null }])
          )
        ])
        expect(batches).toEqual([[1, 2], [3]])
        prepared.resolve()
        await commit.promise
      },
      { lock: [lockKey.text('business'), native.headLock] }
    )
    await prepared.promise
    expect(await log.lastSeq()).toBe(0)
    expect(await log.read(1, 10)).toEqual([])
    expect(notices).toEqual([])
    commit.resolve()
    await transaction
    expect(await log.lastSeq()).toBe(3)
    expect(await log.states(LogRecordState.pending)).toEqual([1, 2, 3])
    expect(notices).toEqual([{ lastSeq: 3, count: 3 }])
    expect(await host.backend('memory').get('business')).toBe('committed')
  })

  it('bypasses an ordinary FIFO waiting for its head and leaves rollback and wrong org invisible', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    await using log = await storageLogStore(host, 'memory', { prefix: 'history' })
    const native = resolveStorageLogNativeAccess(log)
    const notices: unknown[] = []
    log.onAppend((notice) => {
      notices.push(notice)
    })
    const cause = new Error('business callback rolls back')
    await expect(
      host.backend('memory').transaction(
        async (scope) => {
          await native.createPort(scope).append([{ kind: 'rollback', payload: null }])
          await scope.set('business', 'rollback')
          throw cause
        },
        { lock: [native.headLock] }
      )
    ).rejects.toMatchObject({ cause })
    expect(await log.lastSeq()).toBe(0)
    expect(notices).toEqual([])
    let ordinary: Promise<readonly number[]> | undefined
    await host.backend('memory').transaction(
      async (scope) => {
        const port = native.createPort(scope)
        expect(await port.append([{ kind: 'first', payload: null }])).toEqual([1])
        ordinary = log.append([{ kind: 'ordinary', payload: null }])
        expect(await port.append([{ kind: 'second', payload: null }])).toEqual([2])
      },
      { lock: [native.headLock] }
    )
    expect(await ordinary).toEqual([3])
    expect(notices).toEqual([
      { lastSeq: 2, count: 2 },
      { lastSeq: 3, count: 1 }
    ])
    await expect(
      host
        .org(createOrgId())
        .backend('memory')
        .transaction(async (scope) => {
          native.createPort(scope)
        })
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    expect(await log.lastSeq()).toBe(3)
  })
})
