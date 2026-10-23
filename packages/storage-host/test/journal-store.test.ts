import { describe, expect, it, vi } from 'vitest'
import { LogRecordState } from '@migaia/logger/plugins/durable'
import { deferred } from '@migaia/utils/promise'
import {
  createOrgId,
  createStorageHost,
  definePlugin,
  memoryBackendKind,
  memoryBackendPlugin,
  type IStoragePluginCore,
  type IStorageJournalBackendBinding,
  type IStorageJournalNamespaceView
} from '../src/index.js'
import { storageLogStore } from '../src/journal.js'
import { createMemoryBackend } from '../src/backends/memory.js'
import { resolveStorageJournalBinding } from '../src/journal/binding.js'

/** Faults surround real private memory I/O admitted through the original descriptor boundary. */
function nonAtomicPrivatePlugin(fault: {
  beforeSet?: (key: string) => void | Promise<void>
  afterSet?: (key: string) => void
  beforeRemove?: (key: string) => void
}) {
  return definePlugin('history', (core: IStoragePluginCore) => {
    let constructed: ReturnType<typeof createMemoryBackend>
    /** Each method commits independently, modelling a reliable private single-key namespace. */
    const project = (binding: IStorageJournalBackendBinding): IStorageJournalBackendBinding => ({
      forOrg: (orgId) => project(binding.forOrg(orgId)),
      openNamespace: async (prefix) => {
        const namespace = await binding.openNamespace(prefix)
        return {
          ...namespace,
          nativeAtomic: false,
          runCommitted: undefined,
          run: (work) =>
            work({
              get: (key) => namespace.run((view) => view.get(key)),
              has: (key) => namespace.run((view) => view.has(key)),
              set: async (key, value) => {
                await fault.beforeSet?.(key)
                await namespace.run((view) => view.set(key, value))
                fault.afterSet?.(key)
              },
              remove: (key) => {
                fault.beforeRemove?.(key)
                return namespace.run((view) => view.remove(key))
              },
              clearValues: () => namespace.run((view) => view.clearValues()),
              clearAll: () => namespace.run((view) => view.clearAll()),
              keys: () => namespace.run((view) => view.keys())
            } satisfies IStorageJournalNamespaceView)
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

describe('private storage log resource', () => {
  it('attributes malformed owned payloads to the journal wire while retaining the canonical validator cause', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    await using raw = await resolveStorageJournalBinding(host, 'memory').binding.openNamespace(
      'corrupt-payload'
    )
    await raw.run(async (view) => {
      await view.set(
        'head',
        JSON.stringify({ format: 1, generation: 1, lastSeq: 1, time: 1, floor: 1 })
      )
      await view.set(
        'record:0000000000000001',
        '{"generation":1,"record":{"seq":1,"time":1,"kind":"event","payload":1e999}}'
      )
    })
    await raw.dispose()
    await expect(
      storageLogStore(host, 'memory', { prefix: 'corrupt-payload' })
    ).rejects.toMatchObject({
      code: 'JOURNAL_RECORD_INVALID',
      cause: { code: 'LOG_STORE_CORRUPT', cause: { code: 'LOG_PAYLOAD_INVALID' } }
    })
  })
  it('preserves the original exhausted sequence error without sealing committed reads', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    await using raw = await resolveStorageJournalBinding(host, 'memory').binding.openNamespace(
      'exhausted'
    )
    const seq = Number.MAX_SAFE_INTEGER
    await raw.run(async (view) => {
      await view.set(
        'head',
        JSON.stringify({ format: 1, generation: 1, lastSeq: seq, time: 1, floor: seq })
      )
      await view.set(
        `record:${seq}`,
        JSON.stringify({ generation: 1, record: { seq, time: 1, kind: 'last', payload: null } })
      )
    })
    await raw.dispose()
    await using log = await storageLogStore(host, 'memory', { prefix: 'exhausted' })
    await expect(log.append([{ kind: 'exhausted', payload: null }])).rejects.toMatchObject({
      code: 'LOG_SEQUENCE_EXHAUSTED'
    })
    expect(await log.lastSeq()).toBe(seq)
    expect((await log.read(seq, 1))[0]?.seq).toBe(seq)
  })
  it('isolates original organizations, survives business clear and preserves watermarks across reopening', async () => {
    const orgId = createOrgId()
    await using host = await createStorageHost({ org: orgId, plugins: [memoryBackendPlugin()] })
    const first = host.org(createOrgId())
    const second = host.org(createOrgId())
    const log = await storageLogStore(host, 'memory', { prefix: 'history' })
    await using one = await storageLogStore(first, 'memory', { prefix: 'history' })
    await using two = await storageLogStore(second, 'memory', { prefix: 'history' })
    const notices: unknown[] = []
    log.onAppend((notice) => {
      expect(Object.isFrozen(notice)).toBe(true)
      notices.push(notice)
    })
    const payload = { count: 1 }
    const appended = log.append([{ kind: 'created', payload }])
    payload.count = 2
    expect(await appended).toEqual([1])
    await Promise.all([
      one.append([{ kind: 'first', payload: null }]),
      two.append([{ kind: 'second', payload: null }])
    ])
    await host.backend('memory').clearAll()
    expect(await host.backend('memory').keys()).toEqual([])
    expect((await log.read(1, 10))[0]?.payload).toEqual({ count: 1 })
    expect((await one.read(1, 10))[0]?.kind).toBe('first')
    expect((await two.read(1, 10))[0]?.kind).toBe('second')
    await log.setState(1, LogRecordState.done)
    expect(await log.states(LogRecordState.pending)).toEqual([])
    await expect(log.setState(1, LogRecordState.aborted)).rejects.toMatchObject({
      code: 'WAL_RECORD_INVALID'
    })
    await log.truncate(2)
    expect(await log.read(1, 10)).toEqual([])
    expect(await log.lastSeq()).toBe(1)
    expect(await log.append([])).toEqual([])
    expect(notices).toEqual([{ lastSeq: 1, count: 1 }])
    await log.dispose()
    await using reopened = await storageLogStore(host.org(orgId), 'memory', { prefix: 'history' })
    expect(await reopened.lastSeq()).toBe(1)
    expect(await reopened.append([{ kind: 'next', payload: null }])).toEqual([2])
    const rows = await reopened.read(1, 10)
    expect(rows.map((row) => row.seq)).toEqual([2])
    expect(await reopened.states(LogRecordState.pending)).toEqual([2])
    expect((await host.backend('memory').inspectLocks()).length).toBe(1)
  })

  it('holds one original resource lease and preserves main/symbolic cleanup identity', async () => {
    const host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    const log = await storageLogStore(host, 'memory', { prefix: 'exclusive' })
    await expect(storageLogStore(host, 'memory', { prefix: 'exclusive' })).rejects.toMatchObject({
      code: 'LOCK_REJECTED'
    })
    const accepted = log.append([{ kind: 'accepted', payload: true }])
    const main = log.dispose()
    expect(log.dispose()).toBe(main)
    const symbolic = log[Symbol.asyncDispose]()
    expect(log[Symbol.asyncDispose]()).toBe(symbolic)
    expect(symbolic).not.toBe(main)
    await expect(accepted).resolves.toEqual([1])
    await Promise.all([main, symbolic])
    await expect(log.lastSeq()).rejects.toMatchObject({ code: 'STORE_DISPOSED' })
    const replacement = await storageLogStore(host, 'memory', { prefix: 'exclusive' })
    expect(await replacement.lastSeq()).toBe(1)
    const acceptedByRoot = replacement.append([{ kind: 'drained by root', payload: null }])
    const rejectedBeforeNativeAdmission = acceptedByRoot.catch((cause: unknown) => cause)
    await host.dispose()
    const failure = await rejectedBeforeNativeAdmission
    expect(failure).toMatchObject({ code: 'HOST_DISPOSING' })
    await expect(replacement.append([{ kind: 'late', payload: null }])).rejects.toMatchObject({
      code: 'STORE_DISPOSED'
    })
    await expect(storageLogStore(host, 'memory', { prefix: 'late' })).rejects.toMatchObject({
      code: 'STORAGE_HOST_DISPOSED'
    })
  })

  it('retains original numeric and JSON admission and reports rejected append observers once', async () => {
    await using host = await createStorageHost({ plugins: [memoryBackendPlugin()] })
    await using log = await storageLogStore(host, 'memory', { prefix: 'admission' })
    await expect(log.read(0, 1)).rejects.toMatchObject({
      name: 'RangeError',
      code: 'INVALID_OPTION'
    })
    await expect(log.read(1, Number.MAX_SAFE_INTEGER + 1)).rejects.toMatchObject({
      code: 'LOG_SEQUENCE_EXHAUSTED'
    })
    await expect(
      log.append([{ kind: 'invalid', payload: new Date() }] as never)
    ).rejects.toMatchObject({ code: 'LOG_PAYLOAD_INVALID' })
    expect(await log.lastSeq()).toBe(0)
    const diagnostics: unknown[] = []
    const cause = new Error('observer rejected after real commit')
    const spy = vi.spyOn(console, 'error').mockImplementation((_message, error) => {
      diagnostics.push(error)
    })
    try {
      log.onAppend(() => Promise.reject(cause))
      await expect(log.append([{ kind: 'committed', payload: null }])).resolves.toEqual([1])
      await vi.waitFor(() => expect(diagnostics).toEqual([cause]))
    } finally {
      spy.mockRestore()
    }
  })

  it('ignores uncommitted non-native rows and seals an uncertain head until reopening', async () => {
    const cause = new Error('head acknowledgement was lost')
    let fail = false
    const plugin = nonAtomicPrivatePlugin({
      afterSet: (key) => {
        if (fail && key === 'head') {
          fail = false
          throw cause
        }
      }
    })
    await using host = await createStorageHost({ plugins: [plugin] })
    const log = await storageLogStore(host, 'history', { prefix: 'head' })
    fail = true
    await expect(log.append([{ kind: 'uncertain', payload: 1 }])).rejects.toMatchObject({
      code: 'JOURNAL_RECOVERY_FAILED',
      cause
    })
    await expect(log.append([{ kind: 'no retry', payload: 2 }])).rejects.toMatchObject({ cause })
    await log.dispose()
    await using reopened = await storageLogStore(host, 'history', { prefix: 'head' })
    expect(await reopened.lastSeq()).toBe(1)
    expect(await reopened.states(LogRecordState.pending)).toEqual([1])
    expect(await reopened.append([{ kind: 'next', payload: 2 }])).toEqual([2])
    const access = resolveStorageJournalBinding(host, 'history')
    await using raw = await access.binding.openNamespace('orphan')
    await raw.run(async (view) => {
      await view.set(
        'record:0000000000000001',
        JSON.stringify({
          generation: 1,
          record: { seq: 1, time: 1, kind: 'orphan', payload: null }
        })
      )
    })
    await raw.dispose()
    await using empty = await storageLogStore(host, 'history', { prefix: 'orphan' })
    expect(await empty.lastSeq()).toBe(0)
    expect(await empty.read(1, 10)).toEqual([])
  })

  it('recovers previous state when its candidate head did not commit and retains a committed truncate floor', async () => {
    const cause = new Error('private cleanup failed')
    let failHead = false
    let failRemove = false
    const plugin = nonAtomicPrivatePlugin({
      beforeSet: (key) => {
        if (failHead && key === 'head') {
          failHead = false
          throw cause
        }
      },
      beforeRemove: (key) => {
        if (failRemove && key.startsWith('record:')) {
          failRemove = false
          throw cause
        }
      }
    })
    await using host = await createStorageHost({ plugins: [plugin] })
    let log = await storageLogStore(host, 'history', { prefix: 'state' })
    await log.append([
      { kind: 'one', payload: null },
      { kind: 'two', payload: null }
    ])
    failHead = true
    await expect(log.setState(1, LogRecordState.done)).rejects.toMatchObject({ cause })
    await log.dispose()
    log = await storageLogStore(host, 'history', { prefix: 'state' })
    expect(await log.states(LogRecordState.pending)).toEqual([1, 2])
    await log.append([{ kind: 'after failed candidate', payload: null }])
    await log.dispose()
    log = await storageLogStore(host, 'history', { prefix: 'state' })
    expect(await log.states(LogRecordState.pending)).toEqual([1, 2, 3])
    await log.setState(1, LogRecordState.aborted)
    failRemove = true
    await expect(log.truncate(4)).rejects.toMatchObject({ cause })
    await log.dispose()
    await using reopened = await storageLogStore(host, 'history', { prefix: 'state' })
    expect(await reopened.read(1, 10)).toEqual([])
    expect(await reopened.lastSeq()).toBe(3)
    expect(await reopened.append([{ kind: 'four', payload: null }])).toEqual([4])
  })

  it('drains admitted I/O before releasing its original cell and rejects malformed private records without payload diagnostics', async () => {
    const entered = deferred<void>()
    const release = deferred<void>()
    let hold = false
    const plugin = nonAtomicPrivatePlugin({
      beforeSet: async (key) => {
        if (hold && key.startsWith('record:')) {
          entered.resolve()
          await release.promise
        }
      }
    })
    const host = await createStorageHost({ plugins: [plugin] })
    const log = await storageLogStore(host, 'history', { prefix: 'drain' })
    hold = true
    const append = log.append([{ kind: 'accepted', payload: null }])
    await entered.promise
    let closed = false
    const disposal = log.dispose().then(() => {
      closed = true
    })
    expect(closed).toBe(false)
    release.resolve()
    await expect(append).resolves.toEqual([1])
    await disposal
    const access = resolveStorageJournalBinding(host, 'history')
    await using raw = await access.binding.openNamespace('broken')
    await raw.run((view) => view.set('head', '{secret invalid bytes'))
    await raw.dispose()
    await expect(storageLogStore(host, 'history', { prefix: 'broken' })).rejects.toMatchObject({
      code: 'JOURNAL_RECORD_INVALID',
      cause: expect.any(SyntaxError)
    })
    await using reclaimed = await access.binding.openNamespace('broken')
    await reclaimed.run((view) => view.clearAll())
    await host.dispose()
  })
})
