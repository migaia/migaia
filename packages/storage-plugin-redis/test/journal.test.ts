import { afterAll, describe, expect, it } from 'vitest'
import { createClientPool } from 'redis'
import { Logger } from '@migaia/logger'
import { binlog, memoryLogStore, undoLog, wal } from '@migaia/logger/plugins/durable'
import { walkErrorCauses } from '@migaia/utils/error'
import { deferred } from '@migaia/utils/promise'
import { createStorageHost, createOrgId } from '@migaia/storage-host'
import { storageLogStore } from '@migaia/storage-host/journal'
import { encodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import { ttl, vector } from '@migaia/storage-contract'
import { redisBackendPlugin, type IRedisDriver } from '../src/index.js'
import { nodeRedisDriver } from '../src/adapters/node-redis.js'
import { rediSearchVectorFeature } from '../src/features/search.js'
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
    it('publishes actual final drafts per org only after full EXEC and awaits external settle', async () => {
      await connect()
      const prefix = crypto.randomUUID(),
        loggers = new Map<string, ReturnType<typeof createJournalLogger>>(),
        entered = deferred<void>(),
        resume = deferred<void>()
      namespaces.push(prefix)
      let pause = false
      const host = await createStorageHost({
        plugins: [redisBackendPlugin({ driver, prefix })] as const,
        journal: ({ orgId }) => {
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
        }
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
        expect(payload.changes).toHaveLength(1)
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
        const before = await driver.command(['DBSIZE'])
        await expect(storageLogStore(host, 'redis', { prefix: 'cached' })).rejects.toMatchObject({
          code: 'UNSUPPORTED_CAPABILITY'
        })
        expect(await driver.command(['DBSIZE'])).toBe(before)
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
            redisBackendPlugin({ driver, prefix }, { search: rediSearchVectorFeature() })
          ] as const,
          journal: options
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
          plugins: [redisBackendPlugin({ driver, prefix })] as const,
          journal: options
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
          plugins: [redisBackendPlugin({ driver: injected, prefix })] as const,
          journal: { logger, namespace: 'application' }
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
              redisBackendPlugin({ driver: observed, prefix: crypto.randomUUID() })
            ] as const,
            journal: {
              logger,
              namespace: 'unsupported',
              ...(choice === 'atomic' ? { atomicBinlog: { redis: records } } : {})
            }
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
