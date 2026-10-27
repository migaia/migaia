import { afterAll, describe, expect, it, vi } from 'vitest'
import { createClientPool } from 'redis'
import { Logger, type ILogEntry } from '@migaia/logger'
import { level } from '@migaia/logger/plugins'
import {
  binlog,
  memoryLogStore,
  undoLog,
  wal,
  LogRecordState,
  type ILogStore
} from '@migaia/logger/plugins/durable'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { storageJournalPlugin, storageLogStore } from '@migaia/storage-host/journal'
import { encodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import { ConcurrencyPolicy, lockKey } from '@migaia/storage-host/authoring/concurrency'
import { kv, ttl, vector } from '@migaia/storage-contract'
import { redisBackendPlugin, type IRedisDriver } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { rediSearchVectorFeature } from '../src/features/search.js'
import { redisStreamsFeature } from '../src/features/streams.js'
import { redisPubSubFeature } from '../src/features/pubsub.js'
import { createRedisLayout, decodeRedisValue } from '../src/layout.js'

/** Real logger plugins retain their own durable owner and remain borrowed by storage. */
const loggerOptions = {
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false },
  runtimeManager: {
    randomUUID: () => crypto.randomUUID(),
    defer: (task: () => void) => queueMicrotask(task),
    write: () => undefined
  }
} as const

/** Each org owns an independent real logger index over an external log store. */
const createJournalLogger = () =>
  new Logger({ ...loggerOptions, plugins: [binlog({ store: memoryLogStore() })] as const })

for (const service of [
  'MIGAIA_REDIS_URL',
  'MIGAIA_VALKEY_URL',
  'MIGAIA_REDIS_STACK_URL'
] as const) {
  const url = process.env[service]
  describe.skipIf(!url)(service + ' commit-only journal', () => {
    const pool = createClientPool({ url }, { maximum: 8 }),
      driver = nodeRedisDriver(pool),
      namespaces: string[] = []
    const connect = async () => {
      if (!pool.isOpen) await pool.connect()
    }
    it('shares the current private log head across independent handles and reopen', async () => {
      await connect()
      const { redisBackendPlugin: backend } = await import('@migaia/storage-plugin-redis')
      const prefix = crypto.randomUUID(),
        org = createOrgId()
      namespaces.push(prefix)
      const first = await createStorageHost({
          org,
          plugins: [storageJournalPlugin(), backend({ driver, prefix })]
        }),
        second = await createStorageHost({
          org,
          plugins: [storageJournalPlugin(), backend({ driver, prefix })]
        })
      await Promise.all([first.detect(), second.detect()])
      const opened: ILogStore[] = []
      try {
        const a = await storageLogStore(first, 'redis', { prefix: 'shared-native' })
        opened.push(a)
        const b = await storageLogStore(second, 'redis', { prefix: 'shared-native' })
        opened.push(b)
        const notices: { lastSeq: number; count: number }[] = []
        a.onAppend((notice) => {
          notices.push(notice)
        })
        const [one, two] = await Promise.all([
          a.append(
            Array.from({ length: 10 }, (_, index) => ({ kind: 'first', payload: { index } }))
          ),
          b.append(
            Array.from({ length: 10 }, (_, index) => ({ kind: 'second', payload: { index } }))
          )
        ])
        expect([...one, ...two].sort((left, right) => left - right)).toEqual(
          Array.from({ length: 20 }, (_, index) => index + 1)
        )
        expect(notices).toEqual([{ lastSeq: one.at(-1)!, count: 10 }])
        expect(await a.lastSeq()).toBe(20)
        expect(await b.lastSeq()).toBe(20)
        expect(await a.read(1, 100)).toEqual(await b.read(1, 100))
        await a.setState(1, LogRecordState.done)
        await b.setState(2, LogRecordState.aborted)
        expect(await a.states(LogRecordState.pending)).toEqual(
          Array.from({ length: 18 }, (_, index) => index + 3)
        )
        expect(await b.states(LogRecordState.pending)).toEqual(
          await a.states(LogRecordState.pending)
        )
        await first.backend('redis').set('business', 'separate')
        expect(await first.backend('redis').keys()).toEqual(['business'])
        await first.backend('redis').clearAll()
        expect(await a.read(1, 100)).toHaveLength(20)
        await a.dispose()
        expect(await b.append([{ kind: 'after-close', payload: null }])).toEqual([21])
        const reopened = await storageLogStore(first, 'redis', { prefix: 'shared-native' })
        try {
          expect(await reopened.lastSeq()).toBe(21)
          expect(await reopened.states(LogRecordState.pending)).toEqual(
            Array.from({ length: 19 }, (_, index) => index + 3)
          )
          await b.truncate(6)
          expect((await reopened.read(1, 100)).map((record) => record.seq)).toEqual(
            Array.from({ length: 16 }, (_, index) => index + 6)
          )
        } finally {
          await reopened.dispose()
        }
        const organization = await storageLogStore(first.org(createOrgId()), 'redis', {
          prefix: 'shared-native'
        })
        try {
          expect(await organization.lastSeq()).toBe(0)
          expect(await organization.append([{ kind: 'org', payload: null }])).toEqual([1])
          expect(await b.lastSeq()).toBe(21)
        } finally {
          await organization.dispose()
        }
      } finally {
        await Promise.all(opened.map((log) => log.dispose()))
        await Promise.all([first.dispose(), second.dispose()])
      }
    })
    afterAll(async () => {
      if (pool.isOpen) {
        for (const prefix of namespaces) {
          const tag = createRedisLayout(prefix, crypto.randomUUID()).tag
          if (service !== 'MIGAIA_VALKEY_URL') {
            const indexes = (await driver.command(['FT._LIST'])) as string[]
            for (const index of indexes)
              if (index.startsWith(tag + ':vi:')) await driver.command(['FT.DROPINDEX', index])
          }
          let cursor = '0'
          do {
            const reply = (await driver.command([
              'SCAN',
              cursor,
              'MATCH',
              tag + ':*',
              'COUNT',
              '256'
            ])) as [string, string[]]
            cursor = reply[0]
            if (reply[1].length) await driver.command(['DEL', ...reply[1]])
          } while (cursor !== '0')
        }
        await pool.close()
      }
    })
    it('observes one public endpoint across native retries with canonical keys and fixed org', async () => {
      await connect()
      const prefix = crypto.randomUUID(),
        entries: ILogEntry[] = [],
        logger = new Logger({ ...loggerOptions, plugins: [level()] }),
        entered = deferred<void>(),
        resume = deferred<void>()
      namespaces.push(prefix)
      logger.useSink((entry) => {
        entries.push(entry)
      })
      const host = await createStorageHost({
        plugins: [
          storageJournalPlugin({ logger, namespace: 'telemetry', telemetry: true }),
          redisBackendPlugin(
            { driver, prefix },
            {
              streams: redisStreamsFeature(),
              pubsub: redisPubSubFeature()
            }
          )
        ] as const
      })
      try {
        const store = host.backend('redis')
        await store.set('value', 'initial')
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          message: 'set',
          meta: {
            keys: expect.arrayContaining([lockKey.text('value')]),
            payload: { key: 'value', value: 'initial' },
            outcome: 'success'
          }
        })
        await store.get('value')
        expect(entries[1]!.meta!.keys).toEqual([lockKey.text('value')])
        await store.use(kv).getMany(['value', 'absent'])
        expect(entries[2]!.meta!.keys).toEqual([lockKey.text('value'), lockKey.text('absent')])
        entries.length = 0
        let calls = 0
        const pending = store.transaction(
          async (scope) => {
            calls++
            const value = await scope.get('value')
            if (calls === 1) {
              entered.resolve()
              await resume.promise
            }
            await scope.set('value', value + ':transaction')
          },
          { concurrency: ConcurrencyPolicy.optimistic({ retries: 1, backoffMs: 0 }) }
        )
        await entered.promise
        await store.set('value', 'concurrent')
        resume.resolve()
        await pending
        expect(calls).toBe(2)
        expect(entries.map((entry) => entry.message)).toEqual(['set', 'transaction'])
        expect(entries[1]!.meta).toMatchObject({
          keys: expect.arrayContaining([lockKey.text('value')]),
          outcome: 'success'
        })
        entries.length = 0
        const original = new RangeError('original telemetry callback failure')
        await expect(
          store.transaction(async (scope) => {
            await scope.get('value')
            throw original
          })
        ).rejects.toBe(original)
        expect(entries).toHaveLength(1)
        expect(entries[0]!.meta).toMatchObject({ outcome: 'error', code: 'TRANSACTION_FAILED' })
        expect(entries[0]!.args[0]).toBe(original)
        entries.length = 0
        const orgId = createOrgId(),
          peer = host.org(orgId).backend('redis')
        await peer.set('value', 'org')
        const extracted = peer.get
        expect(await extracted('value')).toBe('org')
        expect(entries).toHaveLength(2)
        expect(entries.every((entry) => entry.meta!.orgId === orgId)).toBe(true)
        entries.length = 0
        const readOnlyOrg = createOrgId()
        expect(await host.org(readOnlyOrg).backend('redis').get('absent')).toBeNull()
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          message: 'get',
          meta: { orgId: readOnlyOrg, keys: [lockKey.text('absent')], outcome: 'success' }
        })
        entries.length = 0
        const nativeOrg = createOrgId()
        expect(await host.org(nativeOrg).backend('redis').api.streams.range('jobs')).toEqual([])
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          message: 'streams.range',
          meta: { orgId: nativeOrg, keys: [], outcome: 'success' }
        })
        entries.length = 0
        const resourceOrg = createOrgId(),
          subscription = await host
            .org(resourceOrg)
            .backend('redis')
            .api.pubsub.subscribe('events', () => undefined)
        await subscription.dispose()
        expect(entries).toHaveLength(1)
        expect(entries[0]).toMatchObject({
          message: 'pubsub.subscribe',
          meta: { orgId: resourceOrg, keys: [], outcome: 'success' }
        })
      } finally {
        resume.resolve()
        await host.dispose()
        await logger.shutdown('manual')
      }
    })
    it('retains ordered staged values and TTL changes in the committed binlog', async () => {
      await connect()
      const prefix = crypto.randomUUID(),
        logger = createJournalLogger()
      namespaces.push(prefix)
      const host = await createStorageHost({
        plugins: [
          storageJournalPlugin({ logger, namespace: 'ordered', binlogValues: true }),
          redisBackendPlugin({ driver, prefix })
        ] as const
      })
      try {
        const store = host.backend('redis')
        await store.transaction(async (scope) => {
          await scope.set('a', 'one')
          await scope.putRecord({ rank: 2 }, 'b')
          await scope.set('c', 'three')
          await scope.set('a', 'again')
        })
        const rows = await logger.binlog.read(1),
          changes = (
            rows[0]!.payload as {
              changes: { target: { channel: string; key: string }; value: string }[]
            }
          ).changes
        expect(changes.map((change) => [change.target.channel, change.target.key])).toEqual([
          ['text', encodeFlatStorageKey('a')],
          ['record', encodeFlatStorageKey('b')],
          ['text', encodeFlatStorageKey('c')],
          ['text', encodeFlatStorageKey('a')]
        ])
        expect(
          changes.map((change) => {
            const image = decodeRedisValue('record', change.value) as {
              channel: 'text' | 'record'
              value: string
            }
            return decodeRedisValue(image.channel, image.value)
          })
        ).toEqual(['one', { rank: 2 }, 'three', 'again'])
        expect(await store.get('a')).toBe('again')
        expect(await store.getRecord('b')).toEqual({ rank: 2 })
        await store.transaction(async (scope) => {
          await scope.set('deadline', 'present')
          await scope.use(ttl).expire({ channel: 'text', key: 'deadline' }, 10000)
          await scope.use(ttl).persist({ channel: 'text', key: 'deadline' })
          await scope.remove('deadline')
        })
        const ttlChanges = (
          (await logger.binlog.read(2))[0]!.payload as {
            changes: { present: boolean; value?: string }[]
          }
        ).changes
        expect(ttlChanges).toHaveLength(4)
        expect(ttlChanges.map((change) => change.present)).toEqual([true, true, true, false])
        expect(
          ttlChanges
            .slice(0, 3)
            .map(
              (change) =>
                (decodeRedisValue('record', change.value!) as { expiresAt: number | null })
                  .expiresAt
            )
        ).toEqual([null, expect.any(Number), null])
        expect(await store.get('deadline')).toBeNull()
      } finally {
        await host.dispose()
        await logger.shutdown('manual')
      }
    })
    it('publishes actual ordered drafts per org only after full EXEC and awaits external settle', async () => {
      await connect()
      const prefix = crypto.randomUUID(),
        loggers = new Map<string, ReturnType<typeof createJournalLogger>>(),
        entered = deferred<void>(),
        resume = deferred<void>()
      namespaces.push(prefix)
      let pause = false
      const host = await createStorageHost({
        plugins: [
          storageJournalPlugin(({ orgId }) => {
            const logger = new Logger({
              ...loggerOptions,
              plugins: [binlog({ store: memoryLogStore() })] as const
            })
            loggers.set(orgId, logger)
            const original = logger.binlog
            return {
              namespace: 'application',
              binlogValues: true,
              logger: {
                dispatchRaw: logger.dispatchRaw,
                onFailure: logger.onFailure,
                hook: logger.hook,
                flush: logger.flush,
                defer: logger.defer,
                binlog: {
                  ...original,
                  append: async (...args: Parameters<typeof original.append>) => {
                    const result = await original.append(...args)
                    if (pause) {
                      pause = false
                      entered.resolve()
                      await resume.promise
                    }
                    return result
                  }
                }
              }
            }
          }),
          redisBackendPlugin({ driver, prefix })
        ] as const
      })
      try {
        const store = host.backend('redis'),
          orgId = createOrgId(),
          peer = host.org(orgId).backend('redis')
        await store.set('value', 'first')
        await store.transaction(async (scope) => {
          await scope.set('value', 'second')
          await scope.set('value', 'final')
        })
        const root = [...loggers.values()][0]!,
          rows = await root.binlog.read(1)
        expect(rows).toHaveLength(2)
        const payload = rows.at(-1)!.payload as {
          txId: string
          changes: { target: { channel: string; key: string }; value: string }[]
        }
        expect(payload.changes).toHaveLength(2)
        expect(
          payload.changes.map((change) => {
            const image = decodeRedisValue('record', change.value) as { value: string }
            return decodeRedisValue('text', image.value)
          })
        ).toEqual(['second', 'final'])
        expect(payload.changes[0]?.target).toMatchObject({
          channel: 'text',
          key: encodeFlatStorageKey('value')
        })
        expect(decodeRedisValue('record', payload.changes[0]!.value)).toMatchObject({
          channel: 'text',
          value: expect.any(String),
          expiresAt: null
        })
        await store.use(ttl).expire({ channel: 'text', key: 'value' }, 10000)
        const expiry = (await root.binlog.read(3))[0]!.payload as { changes: { value: string }[] }
        expect(decodeRedisValue('record', expiry.changes[0]!.value)).toMatchObject({
          expiresAt: expect.any(Number)
        })
        const failure = new RangeError('journal callback abort')
        await expect(
          store.transaction(async (scope) => {
            await scope.set('value', 'aborted')
            throw failure
          })
        ).rejects.toBe(failure)
        expect(await store.get('value')).toBe('final')
        expect(await root.binlog.read(1)).toHaveLength(3)
        await peer.set('value', 'org')
        expect(await loggers.get(orgId)!.binlog.read(1)).toHaveLength(1)
        pause = true
        let settled = false
        const pending = store.set('wait', 'native-committed').then(() => {
          settled = true
        })
        await entered.promise
        expect(settled).toBe(false)
        expect(await store.get('wait')).toBe('native-committed')
        resume.resolve()
        await pending
        const command = vi.spyOn(driver, 'command'),
          lease = vi.spyOn(driver, 'withConnection')
        try {
          const native = await storageLogStore(host, 'redis', { prefix: 'current-index' })
          try {
            expect(await native.lastSeq()).toBe(0)
            expect(await native.append([{ kind: 'ordinary', payload: null }])).toEqual([1])
          } finally {
            await native.dispose()
          }
          expect(lease).toHaveBeenCalled()
        } finally {
          command.mockRestore()
          lease.mockRestore()
        }
      } finally {
        resume.resolve()
        await host.dispose()
        for (const logger of loggers.values()) await logger.shutdown('manual')
      }
    })
    if (service !== 'MIGAIA_VALKEY_URL')
      it('captures complete HASH facts and logs historical org removal without selecting Search again', async () => {
        await connect()
        const prefix = crypto.randomUUID(),
          orgId = createOrgId(),
          logger = createJournalLogger()
        namespaces.push(prefix)
        const options = { logger, namespace: 'vector', binlogValues: true }
        const host = await createStorageHost({
          plugins: [
            storageJournalPlugin(options),
            redisBackendPlugin({ driver, prefix }, { search: rediSearchVectorFeature() })
          ] as const
        })
        try {
          const store = host.org(orgId).backend('redis'),
            collection = store.use(vector).collection('items', { dimensions: 2, metric: 'dot' })
          await collection.upsert([{ id: 'point', vector: [1, 2], payload: { retained: true } }])
          await store
            .use(ttl)
            .expire({ channel: 'vector', collection: 'items', id: 'point' }, 10000)
          const rows = await logger.binlog.read(1),
            payload = rows.at(-1)!.payload as { changes: { target: unknown; value: string }[] }
          expect(rows).toHaveLength(2)
          expect(payload.changes[0]?.target).toEqual({
            channel: 'vector',
            collection: 'items',
            id: 'point'
          })
          expect(decodeRedisValue('record', payload.changes[0]!.value)).toMatchObject({
            channel: 'vector',
            value: expect.any(Map),
            expiresAt: expect.any(Number)
          })
        } finally {
          await host.dispose()
        }
        const reopened = await createStorageHost({
          plugins: [storageJournalPlugin(options), redisBackendPlugin({ driver, prefix })] as const
        })
        try {
          await reopened.dropOrg(orgId)
          expect(
            await driver.command([
              'EXISTS',
              createRedisLayout(prefix, orgId).vectorPoint('items', 'point')
            ])
          ).toBe(0)
          const rows = await logger.binlog.read(1),
            payload = rows.at(-1)!.payload as { changes: { target: unknown; present: boolean }[] }
          expect(rows).toHaveLength(3)
          expect(payload.changes).toEqual([
            { target: { channel: 'vector', collection: 'items', id: 'point' }, present: false }
          ])
        } finally {
          await reopened.dispose()
          await logger.shutdown('manual')
        }
      })
    for (const outcome of ['partial', 'unknown'] as const)
      it('does not publish or replay an ' + outcome + ' EXEC', async () => {
        await connect()
        const prefix = crypto.randomUUID(),
          org = createOrgId(),
          layout = createRedisLayout(prefix, org),
          logger = new Logger({
            ...loggerOptions,
            plugins: [binlog({ store: memoryLogStore() })] as const
          }),
          failure = new RangeError('lost native EXEC evidence')
        namespaces.push(prefix)
        let executions = 0
        const injected: IRedisDriver = {
          ...driver,
          withConnection: (run) =>
            driver.withConnection((connection) =>
              run({
                ...connection,
                exec: async (commands) => {
                  executions++
                  const replies = await connection.exec(
                    outcome === 'partial'
                      ? commands.map((command, index) =>
                          index === commands.length - 1
                            ? ['INCR', layout.value('text', 'value')]
                            : command
                        )
                      : commands
                  )
                  if (outcome === 'unknown') throw failure
                  return replies
                }
              })
            )
        }
        const host = await createStorageHost({
          org,
          plugins: [
            storageJournalPlugin({ logger, namespace: 'application' }),
            redisBackendPlugin({ driver: injected, prefix })
          ] as const
        })
        try {
          const store = host.backend('redis')
          await expect(store.set('value', 'committed')).rejects.toMatchObject({
            code: 'REDIS_FAILED'
          })
          expect(await store.get('value')).toBe('committed')
          expect(await logger.binlog.read(1)).toEqual([])
          expect(() => store.set('later', 'blocked')).toThrow()
          expect(executions).toBe(1)
        } finally {
          await host.dispose()
          await logger.shutdown('manual')
        }
      })
    it('rejects WAL, undo and selected atomic carriers before any business EXEC', async () => {
      await connect()
      for (const choice of ['wal', 'undo', 'atomic'] as const) {
        let executions = 0
        const observed: IRedisDriver = {
            ...driver,
            withConnection: (run) =>
              driver.withConnection((connection) =>
                run({
                  ...connection,
                  exec: (commands) => {
                    executions++
                    return connection.exec(commands)
                  }
                })
              )
          },
          records = memoryLogStore(),
          logger = new Logger({
            ...loggerOptions,
            plugins: [
              binlog({ store: records }),
              ...(choice === 'wal' ? [wal({ store: memoryLogStore() })] : []),
              ...(choice === 'undo' ? [undoLog({ store: memoryLogStore() })] : [])
            ]
          })
        try {
          const failure = await createStorageHost({
            plugins: [
              storageJournalPlugin({
                logger,
                namespace: 'unsupported',
                ...(choice === 'atomic' ? { atomicBinlog: { redis: records } } : {})
              }),
              redisBackendPlugin({ driver: observed, prefix: crypto.randomUUID() })
            ] as const
          }).then(
            () => undefined,
            (cause) => cause as unknown
          )
          expect(
            walkErrorCauses(failure).some(
              (cause) =>
                cause instanceof Error && Reflect.get(cause, 'code') === 'UNSUPPORTED_CAPABILITY'
            )
          ).toBe(true)
          expect(executions).toBe(0)
        } finally {
          await logger.shutdown('manual')
        }
      }
    })
  })
}
