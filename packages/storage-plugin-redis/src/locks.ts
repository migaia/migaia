import { RedisCommand, RedisReply } from './constants.js'
import {
  ConcurrencyHolderState,
  readConcurrencyLockIdentities,
  snapshotConcurrencyLockKeys,
  snapshotConcurrencyLockHoldings,
  type IConcurrencyAttemptContext,
  type IConcurrencyHolder,
  type ILockKey,
  type ILockHolding,
  type IStorageKey
} from '@migaia/storage-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { sleep } from '@migaia/utils/promise'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import {
  createRedisLayout,
  replyInteger,
  replyOptionalString,
  replyRevision,
  type IRedisChannel
} from './layout.js'
import { redisError, unsupported } from './errors.js'
import { RedisErrorCode } from './error-code.js'
import { RedisText } from './constants.js'
import { lockLost } from './transaction.js'

/** Native release checks the whole original owner/attempt value, never owner alone. */
const releaseScript =
  "if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) else return 0 end"
/** Lock metadata is portable JSON, not a new serialization format. */
const codec = defineJsonCodec({ version: 1 })
/** Only backend-created acquisition evidence can become an original concurrency conflict. */
export class RedisLockConflict extends Error {
  /** Preserve the actual logical key and native holder until the original policy sees the conflict. */
  constructor(
    readonly keys: readonly ILockKey[],
    readonly holder: IConcurrencyHolder | undefined
  ) {
    super(RedisText.lockConflict)
  }
}
/** Metadata is validated as actual persisted state before it can authorize or describe a lease. */
type IRedisLockValue = {
  readonly owner: string
  readonly token: string
  readonly orgId: string
  readonly key: string
  readonly channel: 'text' | 'bytes' | 'record'
  readonly since: number
  readonly label?: string
}
/** Native lock values preserve canonical logical keys through the original organization codec. */
function decode(value: string): IRedisLockValue {
  try {
    const data = codec.decode(value)
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw redisError(RedisErrorCode.decodeFailed)
    const record = data as Record<string, unknown>
    if (
      typeof record.owner !== 'string' ||
      typeof record.token !== 'string' ||
      typeof record.orgId !== 'string' ||
      typeof record.key !== 'string' ||
      !['text', 'bytes', 'record'].includes(record.channel as string) ||
      typeof record.since !== 'number' ||
      !Number.isSafeInteger(record.since) ||
      (record.label !== undefined && typeof record.label !== 'string')
    )
      throw redisError(RedisErrorCode.decodeFailed)
    return record as IRedisLockValue
  } catch (error) {
    throw redisError(RedisErrorCode.decodeFailed, error)
  }
}
/** Real remote holder metadata never implies process liveness or adds a historical record. */
function holder(value: IRedisLockValue): IConcurrencyHolder {
  return {
    status: 'held',
    owner: value.owner,
    since: value.since,
    scope: 'remote',
    ...(value.label === undefined ? {} : { label: value.label })
  }
}
/**
 * This attempt's native lease is released by its existing connection callback, without another
 * owner.
 */
export function createRedisLocks(options: {
  readonly layout: ReturnType<typeof createRedisLayout>
  readonly context: IConcurrencyAttemptContext
  readonly owner: string
  readonly label: string | undefined
  readonly maxLockMs: number
  readonly send: (args: readonly string[]) => Promise<unknown>
}) {
  const { layout, context, owner, label, maxLockMs, send } = options,
    owned = new Map<string, string>(),
    identities = readConcurrencyLockIdentities(context),
    token = crypto.randomUUID()
  /** Redis TIME supplies inspectable creation metadata and never a client-side expiry timer. */
  const time = async (): Promise<number> => {
    const value = await send([RedisCommand.time])
    if (!Array.isArray(value) || value.length !== 2)
      throw redisError(RedisErrorCode.decodeFailed, value)
    return replyRevision(value[0]) * 1000 + Math.floor(replyRevision(value[1]) / 1000)
  }
  /**
   * Only this attempt's complete values can be removed; late release leaves replacement owners
   * intact.
   */
  const release = async (): Promise<void> => {
    const failures: unknown[] = []
    for (const [key, value] of owned) {
      try {
        replyInteger(await send([RedisCommand.eval, releaseScript, '1', key, value]))
      } catch (error) {
        failures.push(error)
      }
    }
    owned.clear()
    if (failures.length !== 0)
      throw redisError(
        RedisErrorCode.failed,
        new AggregateError(failures, RedisText.failed, { cause: failures[0] })
      )
  }
  /** WATCH precedes GET, so both lock takeover and expiry invalidate the same native EXEC. */
  const check = async (key: ILockKey, identity: string): Promise<void> => {
    const physical = layout.lock(identity)
    await send([RedisCommand.watch, physical])
    const current = replyOptionalString(await send([RedisCommand.get, physical])),
      expected = owned.get(physical)
    if (expected !== undefined) {
      if (current !== expected) throw lockLost()
      return
    }
    if (current !== undefined) throw new RedisLockConflict([key], holder(decode(current)))
  }
  return {
    /** The original policy decides whether a refusal retries in waiting admission. */
    acquire: async (): Promise<void> => {
      if (context.locking !== 'pessimistic' || identities.length === 0) return
      for (;;) {
        throwIfAborted(context.signal)
        try {
          const since = await time()
          for (let index = 0; index < identities.length; index++) {
            const key = context.lock![index]!
            if (key.channel === 'rdf' || key.channel === 'vector') unsupported()
            const physical = layout.lock(identities[index]!),
              value = codec.encode({
                owner,
                token,
                orgId: layout.orgId,
                key: layout.encode(key.key),
                channel: key.channel,
                since,
                ...(label === undefined ? {} : { label })
              }),
              result = await send([
                RedisCommand.set,
                physical,
                value,
                RedisCommand.nx,
                RedisCommand.px,
                String(maxLockMs)
              ])
            if (result === null) {
              const current = replyOptionalString(await send([RedisCommand.get, physical]))
              throw new RedisLockConflict(
                [key],
                current === undefined
                  ? { status: ConcurrencyHolderState.handingOff, scope: 'remote' }
                  : holder(decode(current))
              )
            }
            if (result !== RedisReply.ok) throw redisError(RedisErrorCode.decodeFailed, result)
            owned.set(physical, value)
          }
          for (let index = 0; index < identities.length; index++)
            await check(context.lock![index]!, identities[index]!)
          return
        } catch (error) {
          try {
            await release()
          } catch (cleanup) {
            throw redisError(
              RedisErrorCode.failed,
              new AggregateError([error, cleanup], RedisText.failed, { cause: error })
            )
          }
          await send([RedisCommand.unwatch])
          if (!(error instanceof RedisLockConflict) || context.admission !== 'wait') throw error
          await context.wait(sleep(10, { signal: context.signal }))
        }
      }
    },
    /** Implicit writes use the original canonical lock identity and respect a live remote holder. */
    guard: async (channel: IRedisChannel, key: IStorageKey): Promise<void> => {
      const captured = snapshotConcurrencyLockKeys([{ channel, key }], RedisText.backend)
      await check(captured.keys[0]!, captured.identities[0]!)
    },
    /** Lock loss takes priority over WATCH write conflicts, including after an EXEC null. */
    verify: async (): Promise<void> => {
      for (let index = 0; index < identities.length; index++) {
        if (owned.size === 0) break
        await check(context.lock![index]!, identities[index]!)
      }
    },
    release,
    /** Only actual existing locks become rows; expired native keys have no invented history. */
    inspect: async (): Promise<readonly ILockHolding[]> => {
      const rows: ILockHolding[] = []
      let cursor = '0'
      do {
        const result = await send([
          RedisCommand.scan,
          cursor,
          RedisCommand.match,
          layout.lockPattern,
          RedisCommand.count,
          '100'
        ])
        if (
          !Array.isArray(result) ||
          result.length !== 2 ||
          typeof result[0] !== 'string' ||
          !Array.isArray(result[1])
        )
          throw redisError(RedisErrorCode.decodeFailed, result)
        cursor = result[0]
        for (const key of result[1]) {
          if (typeof key !== 'string') throw redisError(RedisErrorCode.decodeFailed, key)
          const raw = replyOptionalString(await send([RedisCommand.get, key]))
          if (raw === undefined) continue
          const value = decode(raw)
          if (value.orgId !== layout.orgId) continue
          const now = await time(),
            remaining = replyInteger(await send([RedisCommand.pttl, key]))
          if (remaining < 0) continue
          rows.push({
            key: snapshotConcurrencyLockKeys(
              [{ channel: value.channel, key: layout.decode(value.key) }],
              RedisText.backend
            ).keys[0]!,
            holder: holder(value),
            expired: remaining === 0,
            expiresAt: now + remaining
          })
        }
      } while (cursor !== '0')
      return snapshotConcurrencyLockHoldings(rows)
    }
  }
}
