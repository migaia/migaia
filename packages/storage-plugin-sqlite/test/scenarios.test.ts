import { UTILS_SOURCE } from '@migaia/utils/error'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, onTestFinished, vi } from 'vitest'
import { createStorageHost, createOrgId, defineFeature, definePlugin } from '@migaia/storage-host'
import { deferred, sleep } from '@migaia/utils/promise'
import { lockKey } from '@migaia/storage-host/authoring/concurrency'
import { sql, type IOperationContext, type IStorageChange } from '@migaia/storage-contract'
import {
  readTransactionOperationContext,
  runTransactionOperation
} from '@migaia/storage-host/authoring/transaction'
import { sqliteBackendPlugin, sqliteBackendKind, type ISqliteDriver } from '../src/index.js'
import { nodeSqliteDriver } from '../src/node.js'
import { sqliteMaintenanceFeature } from '../src/features/maintenance.js'
/** Maintenance runs through the real selected Feature and the original connection's SQL tag. */
it('backs up and vacuums the actual database while rejecting an occupied connection', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'migaia-sqlite-maintenance-'))
  const connection = nodeSqliteDriver(join(directory, 'source.sqlite'))
  const host = await createStorageHost({
    plugins: [
      sqliteBackendPlugin({ driver: connection }, { maintenance: sqliteMaintenanceFeature() })
    ] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
    rmSync(directory, { recursive: true, force: true })
  })
  const store = host.backend('sqlite')
  await store.set('sentinel', 'kept')
  /** Observe execution after preparation, preserving the statement's real native run result. */
  const executed: string[] = []
  const prepare = connection.prepare
  vi.spyOn(connection, 'prepare').mockImplementation((text) => {
    /** The native connection still owns all read methods and the actual maintenance statement. */
    const statement = prepare(text)
    return {
      ...statement,
      run: (...values) => {
        executed.push(text)
        return statement.run(...values)
      }
    }
  })
  const target = join(directory, 'backup.sqlite')
  await store.api.maintenance.backup(target)
  expect(executed).toContain('VACUUM INTO ?')
  const copy = nodeSqliteDriver(target)
  const copied = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: copy })] as const
  })
  try {
    expect(await copied.backend('sqlite').get('sentinel')).toBe('kept')
  } finally {
    await copied.dispose()
    await copy.dispose()
  }
  await store.api.maintenance.vacuum()
  expect(executed).toContain('VACUUM')
  expect(await store.get('sentinel')).toBe('kept')
  await expect(store.api.maintenance.backup(target)).rejects.toMatchObject({
    code: 'SQLITE_FAILED',
    cause: expect.any(Error)
  })
  await store.transaction(async () => {
    await expect(store.api.maintenance.vacuum()).rejects.toMatchObject({
      code: 'TRANSACTION_FAILED'
    })
  })
})

/** Publication reaches the real controller through the supported selected Feature getter. */
it('publishes canonical changed keys once in fixed channel order only after commit', async () => {
  const connection = nodeSqliteDriver(':memory:')
  /** An allowed injected driver retains native bigint change counts, including zero. */
  const driver: ISqliteDriver = {
    exec: connection.exec,
    prepare: (sql) => {
      const statement = connection.prepare(sql)
      return {
        get: statement.get,
        all: statement.all,
        run: (...values) => {
          const result = statement.run(...values)
          return { ...result, changes: BigInt(result.changes) }
        }
      }
    }
  }
  const notifications = defineFeature(sqliteBackendKind, ({ featureExpose }) => ({
    capabilities: [],
    chain: {},
    api: {
      store: {
        async controller() {
          return featureExpose.getChangeController()
        }
      },
      transaction: {}
    }
  }))
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver }, { notifications })] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  const events: IStorageChange[] = []
  const controller = await store.api.controller()
  const unsubscribe = controller!.subscribe((event) => events.push(event))
  onTestFinished(unsubscribe)
  const keys = [[1, 'array'], new Date(1), new Uint8Array([1, 2]).buffer] as const
  await store.transaction(async (tx) => {
    for (const key of keys) {
      await tx.putRecord({ version: 1 }, key)
      await tx.putRecord({ version: 2 }, key)
    }
    await tx.setBytes('binary', new Uint8Array([1]))
    await tx.set('text', '1')
    await tx.set('text', '2')
    expect(events).toEqual([])
  })
  expect(events.map((event) => event.channel)).toEqual(['value', 'bytes', 'record'])
  expect(events.map((event) => event.keys)).toEqual([['text'], ['binary'], keys])
  expect(events[2]!.keys![0]).not.toBe(keys[0])
  events.length = 0
  await store.transaction(async (tx) => {
    await tx.remove('missing')
    expect(await tx.removeMany(['missing', ['missing'], 'missing'])).toBe(0)
  })
  expect(events).toEqual([])
  await expect(
    store.transaction(async (tx) => {
      await tx.set('rolled-back', '1')
      throw new Error('rollback publication')
    })
  ).rejects.toMatchObject({ code: 'TRANSACTION_FAILED' })
  expect(events).toEqual([])
})

/** The original deadline includes actual asynchronous stage settlement before any native write. */
it('keeps asynchronous pipeline preparation inside the original root deadline', async () => {
  const connection = nodeSqliteDriver(':memory:')
  let pipelineCalls = 0
  let settled = false
  const slow = definePlugin('slow', (core) => ({
    install() {
      core.useAsyncPipeline(async (request, next) => {
        if (request.operation === 'set') {
          pipelineCalls++
          await sleep(60)
          settled = true
        }
        await next(request)
      })
      return {}
    }
  }))
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection }), slow] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  /** The first mutation must prepare BEGIN before it can perform any native transaction work. */
  const native = vi.spyOn(connection, 'prepare')
  await expect(
    store.set('late', 'must-not-commit', {
      timeoutMs: 20
    })
  ).rejects.toMatchObject({ code: 'ABORTED' })
  expect(settled).toBe(true)
  expect(pipelineCalls).toBe(1)
  expect(native).not.toHaveBeenCalled()
  expect(await store.get('late')).toBeNull()
})

/** Existing middleware surrounds the actual committed result and the exact native error. */
it('keeps after-next reads and native error catches around the real terminal', async () => {
  const connection = nodeSqliteDriver(':memory:')
  let readCommitted!: () => Promise<string | null>
  let afterNext: string | null | undefined
  let caught: unknown
  const around = definePlugin('around', (core) => ({
    install() {
      core.useAsyncPipeline(async (request, next) => {
        if (request.operation !== 'set') {
          await next(request)
          return
        }
        try {
          await next(request)
          if ((request.input as { key?: unknown }).key === 'wrapped')
            afterNext = await readCommitted()
        } catch (error) {
          caught = error
          throw error
        }
      })
      return {}
    }
  }))
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection }), around] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  readCommitted = () => store.get('wrapped')
  await store.set('wrapped', 'committed')
  // This isolated memory database forces an actual driver failure through the public SQL endpoint.
  await store.sql`DROP TABLE migaia_text`.run()
  const failure = await store.set('failed', 'native').catch((error) => error)
  expect(failure).toMatchObject({ code: 'SQLITE_FAILED', cause: expect.any(Error) })
  expect([afterNext, caught === failure]).toEqual(['committed', true])
})

/** Composed work borrows the actual attempt signal and drains before native rollback releases it. */
it('shares the original attempt context with cancellable transaction composition', async () => {
  /** The installed middleware sees the same attempt fields passed to the native owner. */
  let attemptContext: IOperationContext | undefined
  const inspect = definePlugin('inspect-context', (core) => ({
    install() {
      core.useAsyncPipeline((request, next) => {
        if (request.operation === 'transaction') attemptContext = request.ctx
        return next(request)
      })
      return {}
    }
  }))
  const connection = nodeSqliteDriver(':memory:')
  const host = await createStorageHost({
    plugins: [sqliteBackendPlugin({ driver: connection }), inspect] as const
  })
  onTestFinished(async () => {
    await host.dispose()
    await connection.dispose()
  })
  const store = host.backend('sqlite')
  /** Caller cancellation propagates through the existing concurrency budget's live signal. */
  const cancellation = new AbortController()
  const entered = deferred<void>()
  /** Saved user views lose context access when the original callback ends. */
  let expired!: Parameters<Parameters<typeof store.transaction>[0]>[0]
  let settled = false
  /** Native owner normalization keeps a cooperative callback failure reachable by identity. */
  let cancelledWorkFailure: unknown
  const result = store
    .transaction(
      async (tx) => {
        expired = tx
        await tx.set('cancelled-context', 'rollback')
        const captured = readTransactionOperationContext(tx)
        await runTransactionOperation(tx, async (operation) => {
          entered.resolve()
          expect(captured).toBeDefined()
          expect(readTransactionOperationContext(operation)).toBe(captured)
          expect(captured?.signal).toBe(attemptContext?.signal)
          expect(captured?.signal).toBeDefined()
          try {
            await sleep(60_000, { signal: captured?.signal })
          } catch (error) {
            cancelledWorkFailure = error
            throw error
          } finally {
            settled = true
          }
        })
      },
      {
        lock: [lockKey.text('cancelled-context')],
        signal: cancellation.signal,
        timeoutMs: 1000
      }
    )
    .catch((error: unknown) => error)
  await entered.promise
  cancellation.abort()
  const failure = await result
  expect((failure as Error).cause).toBe(cancelledWorkFailure)
  expect(failure).toMatchObject({
    source: '@migaia/storage-plugin-sqlite',
    code: 'TRANSACTION_FAILED',
    cause: cancelledWorkFailure
  })
  expect(cancelledWorkFailure).toMatchObject({
    source: UTILS_SOURCE,
    code: 'ABORTED',
    cause: cancellation.signal.reason
  })
  expect(settled).toBe(true)
  expect(await store.get('cancelled-context')).toBeNull()
  expect(await store.inspectLocks()).toEqual([])
  expect(() => readTransactionOperationContext(expired)).toThrowError(
    expect.objectContaining({ code: 'INVALID_ARGUMENT' })
  )
})

/** Native Feature resolution authenticates each original root or explicit-org transaction owner. */
it('uses genuine organization scopes without exposing caller SQL or rerunning Feature factories', async () => {
  await using connection = nodeSqliteDriver(':memory:')
  let factories = 0
  const clients: ISqliteDriver[] = []
  const eventOrganizations: (string | undefined)[] = []
  const native = defineFeature(sqliteBackendKind, (core) => {
    factories++
    return {
      capabilities: [] as const,
      chain: {},
      api: {
        store: {
          native: {
            async client() {
              return this.client
            },
            async observe() {
              return core.featureExpose.getChangeController()!.subscribe((change) => {
                eventOrganizations.push(change.orgId)
              })
            }
          }
        },
        transaction: {
          native: {
            async client() {
              clients.push(this.client)
              return this.client
            }
          }
        }
      }
    }
  })
  const org = createOrgId()
  await using host = await createStorageHost({
    org,
    plugins: [
      sqliteBackendPlugin(
        { driver: connection },
        { native, maintenance: sqliteMaintenanceFeature() }
      )
    ]
  })
  const root = host.backend('sqlite')
  const same = host.org(org).backend('sqlite')
  const otherOrg = createOrgId()
  const other = host.org(otherOrg).backend('sqlite')
  const unsubscribe = await root.api.native.observe()
  const rootClient = await root.api.native.client()
  expect(await same.api.native.client()).toBe(rootClient)
  for (const store of [root, same, other]) {
    await store.transaction(async (scope) => {
      expect(await scope.api.native.client()).toBe(await store.api.native.client())
      await scope.set('native-scope', 'kept')
    })
  }
  await root.set('routed-context', 'other', { orgId: otherOrg })
  expect(eventOrganizations.at(-1)).toBe(otherOrg)
  expect(await other.get('routed-context')).toBe('other')
  expect(await root.get('routed-context')).toBeNull()
  unsubscribe()
  expect(factories).toBe(1)
  expect(clients).toHaveLength(3)
  expect(await root.get('native-scope')).toBe('kept')
  await expect(same.api.maintenance.vacuum()).rejects.toMatchObject({
    code: 'UNSUPPORTED_CAPABILITY'
  })
  await expect(other.api.maintenance.vacuum()).rejects.toMatchObject({
    code: 'UNSUPPORTED_CAPABILITY'
  })
  expect(same.has(sql)).toBe(false)
  await expect(same.transaction((scope) => scope.sql`SELECT 1`.all())).rejects.toMatchObject({
    code: 'TRANSACTION_FAILED',
    cause: expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
  })
})
