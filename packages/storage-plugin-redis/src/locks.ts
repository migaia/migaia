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
  readonly key?: string
  readonly collection?: string
  readonly id?: string
  readonly channel: 'text' | 'bytes' | 'record' | 'vector'
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
      !['text', 'bytes', 'record', 'vector'].includes(record.channel as string) ||
      (record.channel === 'vector'
        ? typeof record.collection !== 'string' || typeof record.id !== 'string'
        : typeof record.key !== 'string') ||
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
/** Exact inputs for the original native lease; no queue or second logical lock owner. */
type IRedisLockOptions = {
  readonly layout: ReturnType<typeof createRedisLayout>
  readonly context: IConcurrencyAttemptContext
  readonly owner: string
  readonly label: string | undefined
  readonly maxLockMs: number
  readonly send: (args: readonly string[]) => Promise<unknown>
}
/** One attempt owns its original acquired values and the unique token used for late-safe release. */
class RedisLocks {
  /** Native layout and original policy context remain fixed for this attempt. */
  readonly #options: IRedisLockOptions
  /** Only values actually acquired by this attempt authorize release. */
  readonly #owned = new Map<string, string>()
  /** Canonical identity order is borrowed from the original logical context. */
  readonly #identities: readonly string[]
  /** A fresh attempt token prevents late release from deleting a successor lease. */
  readonly #token = crypto.randomUUID()
  /** Capture existing native attempt inputs without I/O. */
  constructor(options: IRedisLockOptions) {
    this.#options = options
    this.#identities = readConcurrencyLockIdentities(options.context)
  }
  /** Execute time against this original native attempt and complete owner/token evidence. */
  async #time(): Promise<number> {
    const value = await this.#options.send([RedisCommand.time])
    if (!Array.isArray(value) || value.length !== 2)
      throw redisError(RedisErrorCode.decodeFailed, value)
    return replyRevision(value[0]) * 1000 + Math.floor(replyRevision(value[1]) / 1000)
  }
  /** Execute release against this original native attempt and complete owner/token evidence. */
  readonly release = async (): Promise<void> => {
    const failures: unknown[] = []
    for (const [key, value] of this.#owned) {
      try {
        replyInteger(await this.#options.send([RedisCommand.eval, releaseScript, '1', key, value]))
      } catch (error) {
        failures.push(error)
      }
    }
    this.#owned.clear()
    if (failures.length !== 0)
      throw redisError(
        RedisErrorCode.failed,
        new AggregateError(failures, RedisText.failed, { cause: failures[0] })
      )
  }
  /** Execute check against this original native attempt and complete owner/token evidence. */
  async #check(key: ILockKey, identity: string): Promise<void> {
    const physical = this.#options.layout.lock(identity)
    await this.#options.send([RedisCommand.watch, physical])
    const current = replyOptionalString(await this.#options.send([RedisCommand.get, physical])),
      expected = this.#owned.get(physical)
    if (expected !== undefined) {
      if (current !== expected) throw lockLost()
      return
    }
    if (current !== undefined) throw new RedisLockConflict([key], holder(decode(current)))
  }
  /** Execute acquire against this original native attempt and complete owner/token evidence. */
  readonly acquire = async (): Promise<void> => {
    if (this.#options.context.locking !== 'pessimistic' || this.#identities.length === 0) return
    for (;;) {
      throwIfAborted(this.#options.context.signal)
      try {
        const since = await this.#time()
        for (let index = 0; index < this.#identities.length; index++) {
          const key = this.#options.context.lock![index]!
          if (key.channel === 'rdf') unsupported()
          const physical = this.#options.layout.lock(this.#identities[index]!),
            value = codec.encode({
              owner: this.#options.owner,
              token: this.#token,
              orgId: this.#options.layout.orgId,
              ...(key.channel === 'vector'
                ? { collection: key.collection, id: key.id }
                : { key: this.#options.layout.encode(key.key) }),
              channel: key.channel,
              since,
              ...(this.#options.label === undefined ? {} : { label: this.#options.label })
            }),
            result = await this.#options.send([
              RedisCommand.set,
              physical,
              value,
              RedisCommand.nx,
              RedisCommand.px,
              String(this.#options.maxLockMs)
            ])
          if (result === null) {
            const current = replyOptionalString(
              await this.#options.send([RedisCommand.get, physical])
            )
            throw new RedisLockConflict(
              [key],
              current === undefined
                ? { status: ConcurrencyHolderState.handingOff, scope: 'remote' }
                : holder(decode(current))
            )
          }
          if (result !== RedisReply.ok) throw redisError(RedisErrorCode.decodeFailed, result)
          this.#owned.set(physical, value)
        }
        for (let index = 0; index < this.#identities.length; index++)
          await this.#check(this.#options.context.lock![index]!, this.#identities[index]!)
        return
      } catch (error) {
        try {
          await this.release()
        } catch (cleanup) {
          throw redisError(
            RedisErrorCode.failed,
            new AggregateError([error, cleanup], RedisText.failed, { cause: error })
          )
        }
        await this.#options.send([RedisCommand.unwatch])
        if (!(error instanceof RedisLockConflict) || this.#options.context.admission !== 'wait')
          throw error
        await this.#options.context.wait(sleep(10, { signal: this.#options.context.signal }))
      }
    }
  }
  /** Execute guard against this original native attempt and complete owner/token evidence. */
  readonly guard = async (channel: IRedisChannel, key: IStorageKey): Promise<void> => {
    const captured = snapshotConcurrencyLockKeys([{ channel, key }], RedisText.backend)
    await this.#check(captured.keys[0]!, captured.identities[0]!)
  }
  /** Execute guardVector against this original native attempt and complete owner/token evidence. */
  readonly guardVector = async (key: Extract<ILockKey, { channel: 'vector' }>): Promise<void> => {
    const captured = snapshotConcurrencyLockKeys([key], RedisText.backend)
    await this.#check(captured.keys[0]!, captured.identities[0]!)
  }
  /** Execute verify against this original native attempt and complete owner/token evidence. */
  readonly verify = async (): Promise<void> => {
    for (let index = 0; index < this.#identities.length; index++) {
      if (this.#owned.size === 0) break
      await this.#check(this.#options.context.lock![index]!, this.#identities[index]!)
    }
  }
  /** Execute inspect against this original native attempt and complete owner/token evidence. */
  readonly inspect = async (): Promise<readonly ILockHolding[]> => {
    const rows: ILockHolding[] = []
    let cursor = '0'
    do {
      const result = await this.#options.send([
        RedisCommand.scan,
        cursor,
        RedisCommand.match,
        this.#options.layout.lockPattern,
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
        const raw = replyOptionalString(await this.#options.send([RedisCommand.get, key]))
        if (raw === undefined) continue
        const value = decode(raw)
        if (value.orgId !== this.#options.layout.orgId) continue
        const now = await this.#time(),
          remaining = replyInteger(await this.#options.send([RedisCommand.pttl, key]))
        if (remaining < 0) continue
        rows.push({
          key: snapshotConcurrencyLockKeys(
            [
              value.channel === 'vector'
                ? { channel: 'vector', collection: value.collection!, id: value.id! }
                : { channel: value.channel, key: this.#options.layout.decode(value.key!) }
            ],
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
/** Create only native lease evidence inside the existing borrowed-connection callback. */
export function createRedisLocks(options: IRedisLockOptions) {
  return new RedisLocks(options)
}
