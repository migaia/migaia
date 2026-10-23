import { RedisCommand } from './constants.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  snapshotStorageCounterIncrement,
  type IConcurrencyAttemptContext,
  type IConflictPolicy,
  type IStorageKey
} from '@migaia/storage-contract'
import { planChannelWrite } from '@migaia/storage-host/authoring/backend'
import type { IRedisConnection, IRedisExecEntry } from './driver.js'
import { redisError, invalidArgument } from './errors.js'
import { RedisErrorCode } from './error-code.js'
import { RedisText, redisExecCause } from './constants.js'
import {
  createRedisLayout,
  decodeRedisValue,
  encodeRedisValue,
  replyOptionalString,
  replyInteger,
  replyRevision,
  type IRedisChannel
} from './layout.js'

/** One original attempt holds only detached native values and intended writes. */
export type IRedisDraftEntry = {
  readonly channel: IRedisChannel
  readonly key: IStorageKey
  readonly encoded: string
  readonly physical: string
  readonly original: string | undefined
  value: string | undefined
  changed: boolean
  expiry: 'keep' | 'persist' | number
}
/** Redis commands and EXEC outcomes stay with the same borrowed connection. */
export type IRedisCommand = readonly (string | Uint8Array)[]
/** A draft is private to its original transaction owner and is never a public scope credential. */
export class RedisDraft {
  /** Genuine native connection remains leased by the injected driver throughout this attempt. */
  readonly connection: IRedisConnection
  /** Physical mapping is captured once for this organization's native attempt. */
  readonly layout: ReturnType<typeof createRedisLayout>
  /** Original concurrency context owns cancellation, timeout and retry decisions. */
  readonly context: IConcurrencyAttemptContext
  /** Native data facts and changes are distinct from owner lifecycle state. */
  readonly entries = new Map<string, IRedisDraftEntry>()
  /** Original revision fields distinguish logical conflicts from unrelated shared WATCH aborts. */
  readonly revisions = new Map<string, number>()
  /** Read ranges retain their original revision field without a parallel query engine. */
  readonly ranges = new Set<'text' | 'record'>()
  /** Native fixed-command observation wraps the same connection, never another lease. */
  readonly send: (args: readonly string[]) => Promise<unknown>
  /** Writes consult the same original native lease before changing their detached draft. */
  readonly guard: (channel: IRedisChannel, key: IStorageKey) => Promise<void>
  /** Missing ordered members are removed only while their actual point and index remain watched. */
  readonly prunes = new Map<'text' | 'record', Set<string>>()

  /** Construction has no Redis I/O; start establishes WATCH before any dependent read. */
  constructor(
    connection: IRedisConnection,
    layout: ReturnType<typeof createRedisLayout>,
    context: IConcurrencyAttemptContext,
    send: (args: readonly string[]) => Promise<unknown>,
    guard: (channel: IRedisChannel, key: IStorageKey) => Promise<void>
  ) {
    this.connection = connection
    this.layout = layout
    this.context = context
    this.send = send
    this.guard = guard
  }
  /** The shared revision HASH is watched before callbacks can read or write a draft. */
  async start(): Promise<void> {
    await this.send([RedisCommand.watch, this.layout.revisions])
  }
  /** Every dependent key and its original revision are watched before the first native GET. */
  async load(channel: IRedisChannel, key: IStorageKey): Promise<IRedisDraftEntry> {
    const id = this.layout.revision(channel, key),
      existing = this.entries.get(id)
    if (existing) return existing
    const physical = this.layout.value(channel, key)
    await this.send([RedisCommand.watch, physical])
    await this.captureRevision(id)
    const value = replyOptionalString(await this.send([RedisCommand.get, physical])),
      entry: IRedisDraftEntry = {
        channel,
        key,
        encoded: this.layout.encode(key),
        physical,
        original: value,
        value,
        changed: false,
        expiry: 'keep'
      }
    this.entries.set(id, entry)
    return entry
  }
  /** Batch loading issues one native MGET and retains duplicate input positions in its caller. */
  async loadMany(
    channel: IRedisChannel,
    keys: readonly IStorageKey[]
  ): Promise<readonly IRedisDraftEntry[]> {
    const missing = new Map<string, IStorageKey>()
    for (const key of keys) {
      const id = this.layout.revision(channel, key)
      if (!this.entries.has(id)) missing.set(id, key)
    }
    if (missing.size !== 0) {
      const items = [...missing],
        physical = items.map(([, key]) => this.layout.value(channel, key))
      await this.send([RedisCommand.watch, ...physical])
      const revisions = await this.send([
        RedisCommand.hmget,
        this.layout.revisions,
        ...items.map(([id]) => id)
      ])
      if (!Array.isArray(revisions) || revisions.length !== items.length)
        throw redisError(RedisErrorCode.decodeFailed, revisions)
      const values = await this.send([RedisCommand.mget, ...physical])
      if (!Array.isArray(values) || values.length !== items.length)
        throw redisError(RedisErrorCode.decodeFailed, values)
      for (let index = 0; index < items.length; index++) {
        const [id, key] = items[index]!,
          value = replyOptionalString(values[index])
        this.revisions.set(id, replyRevision(revisions[index]))
        this.entries.set(id, {
          channel,
          key,
          encoded: this.layout.encode(key),
          physical: physical[index]!,
          original: value,
          value,
          changed: false,
          expiry: 'keep'
        })
      }
    }
    return keys.map((key) => this.entries.get(this.layout.revision(channel, key))!)
  }
  /** Reads decode a detached value without permitting callers to mutate the native draft. */
  async read(channel: IRedisChannel, key: IStorageKey): Promise<unknown> {
    const entry = await this.load(channel, key)
    return entry.value === undefined ? undefined : decodeRedisValue(channel, entry.value)
  }
  /** Original channel conflict planning runs before any native command is queued. */
  async write(
    channel: IRedisChannel,
    key: IStorageKey,
    wire: string,
    policy: IConflictPolicy,
    ttlMs?: number
  ): Promise<void> {
    await this.guard(channel, key)
    const existing = new Set<'value' | 'bytes' | 'record'>(),
      values = await Promise.all(
        (['text', 'bytes', 'record'] as const).map((other) => this.load(other, key))
      )
    for (const entry of values)
      if (entry.value !== undefined)
        existing.add(entry.channel === 'text' ? 'value' : entry.channel)
    const plan = planChannelWrite(
      key,
      channel === 'text' ? 'value' : channel,
      existing,
      policy,
      RedisText.backend
    )
    for (const other of plan.remove) await this.remove(other === 'value' ? 'text' : other, key)
    const entry = this.entries.get(this.layout.revision(channel, key))!
    entry.value = wire
    entry.changed = true
    if (ttlMs !== undefined) {
      entry.expiry = ttlMs === 0 ? 0 : (await this.now()) + Math.ceil(ttlMs)
      if (ttlMs === 0) entry.value = undefined
    }
  }
  /** Removal counts actual draft membership; no absent key receives a false mutation count. */
  async remove(channel: IRedisChannel, key: IStorageKey): Promise<boolean> {
    await this.guard(channel, key)
    const entry = await this.load(channel, key)
    if (entry.value === undefined) return false
    entry.value = undefined
    entry.changed = true
    return true
  }
  /** TTL uses only Redis TIME and native PTTL, including deadlines changed by this same draft. */
  async remaining(channel: IRedisChannel, key: IStorageKey): Promise<number | undefined> {
    const entry = await this.load(channel, key)
    if (entry.value === undefined || entry.expiry === 'persist') return undefined
    if (typeof entry.expiry === 'number') return Math.max(0, entry.expiry - (await this.now()))
    const value = replyInteger(await this.send([RedisCommand.pttl, entry.physical]))
    return value < 0 ? undefined : value
  }
  /** Expire and persist become commands in the same EXEC as all other draft mutations. */
  async expire(channel: IRedisChannel, key: IStorageKey, ms?: number): Promise<boolean> {
    await this.guard(channel, key)
    const entry = await this.load(channel, key)
    if (entry.value === undefined) return false
    const remaining = await this.remaining(channel, key)
    if (ms === undefined && remaining === undefined) return false
    entry.changed = true
    entry.expiry = ms === undefined ? 'persist' : ms === 0 ? 0 : (await this.now()) + Math.ceil(ms)
    if (ms === 0) entry.value = undefined
    return true
  }
  /** Canonical decimal arithmetic reuses the original counter validator and retains native TTL. */
  async increment(key: string, by?: number): Promise<number> {
    const calculate = snapshotStorageCounterIncrement(by, RedisText.backend),
      current = await this.read('text', key),
      result = calculate(current === undefined ? null : (current as string))
    await this.write('text', key, encodeRedisValue('text', String(result)), 'conflict')
    return result
  }
  /** Native database time is validated before it can become a deadline. */
  async now(): Promise<number> {
    const value = await this.send([RedisCommand.time])
    if (!Array.isArray(value) || value.length !== 2)
      throw redisError(RedisErrorCode.decodeFailed, value)
    const seconds = replyRevision(value[0]),
      micros = replyRevision(value[1]),
      now = seconds * 1000 + Math.floor(micros / 1000)
    if (!Number.isSafeInteger(now) || micros > 999999)
      throw redisError(RedisErrorCode.decodeFailed, value)
    return now
  }
  /** Range reads depend on the real native ordered index before enumeration starts. */
  async watchRange(channel: 'text' | 'record'): Promise<void> {
    if (this.ranges.has(channel)) return
    await this.send([RedisCommand.watch, this.layout.index(channel)])
    await this.captureRevision(this.layout.rangeRevision(channel))
    this.ranges.add(channel)
  }
  /**
   * Comparison occurs under a new WATCH after null EXEC; only unrelated changes permit physical
   * replay.
   */
  async unchanged(): Promise<boolean> {
    await this.start()
    for (const [field, expected] of this.revisions)
      if (
        replyRevision(await this.send([RedisCommand.hget, this.layout.revisions, field])) !==
        expected
      )
        return false
    for (const entry of this.entries.values()) {
      await this.send([RedisCommand.watch, entry.physical])
      if (
        replyOptionalString(await this.send([RedisCommand.get, entry.physical])) !== entry.original
      )
        return false
    }
    for (const channel of this.ranges)
      await this.send([RedisCommand.watch, this.layout.index(channel)])
    return true
  }
  /** Fixed commands retain indexes, values and revisions in one atomic native execution. */
  commands(): IRedisCommand[] {
    const commands: IRedisCommand[] = []
    for (const entry of this.entries.values()) {
      if (!entry.changed) continue
      if (
        typeof entry.expiry === 'number' &&
        (!Number.isSafeInteger(entry.expiry) || entry.expiry < 0)
      )
        throw invalidArgument()
      if (entry.value === undefined || entry.expiry === 0)
        commands.push([RedisCommand.del, entry.physical])
      else {
        commands.push([RedisCommand.set, entry.physical, entry.value, RedisCommand.keepttl])
        if (entry.expiry === 'persist') commands.push([RedisCommand.persist, entry.physical])
        else if (typeof entry.expiry === 'number')
          commands.push([RedisCommand.pexpireat, entry.physical, String(entry.expiry)])
      }
      if (entry.channel !== 'bytes')
        commands.push([
          entry.value === undefined || entry.expiry === 0 ? RedisCommand.zrem : RedisCommand.zadd,
          this.layout.index(entry.channel),
          ...(entry.value === undefined || entry.expiry === 0 ? [] : ['0']),
          entry.encoded
        ])
      commands.push([
        RedisCommand.hincrby,
        this.layout.revisions,
        this.layout.revision(entry.channel, entry.key),
        '1'
      ])
      commands.push([
        RedisCommand.hincrby,
        this.layout.revisions,
        this.layout.rangeRevision(entry.channel),
        '1'
      ])
    }
    for (const [channel, members] of this.prunes)
      if (members.size !== 0)
        commands.push([RedisCommand.zrem, this.layout.index(channel), ...members])
    return commands
  }
  /** Logical baselines are captured only once before native reads, never from a public scope marker. */
  async captureRevision(field: string): Promise<void> {
    if (!this.revisions.has(field))
      this.revisions.set(
        field,
        replyRevision(await this.send([RedisCommand.hget, this.layout.revisions, field]))
      )
  }
}
/** Full native EXEC evidence stays reachable when any command may have committed. */
export function validateRedisExec(entries: readonly IRedisExecEntry[], expected: number): void {
  if (entries.length !== expected) throw redisError(RedisErrorCode.decodeFailed, entries)
  const failures = entries.flatMap((entry) => (entry.ok ? [] : [entry.error]))
  if (failures.length !== 0) {
    const native: unknown = Reflect.get(entries, redisExecCause),
      evidence = new AggregateError(
        native instanceof Error ? [native, ...failures] : failures,
        RedisText.failed,
        { cause: native instanceof Error ? native : failures[0] }
      )
    Object.defineProperty(evidence, 'replies', { value: entries })
    throw redisError(RedisErrorCode.failed, evidence)
  }
}
/** Native locks expire by Redis clock; a missing or replaced original token is lock loss. */
export function lockLost(): StorageContractError {
  return new StorageContractError(StorageContractErrorCode.lockLost, { backend: RedisText.backend })
}
