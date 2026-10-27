import { isUint8Array } from '@migaia/utils/bytes'
import { RedisCommand } from './constants.js'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IConcurrencyAttemptContext,
  type IConflictPolicy,
  type IStorageKey,
  type ILockKey
} from '@migaia/storage-contract'
import {
  snapshotStorageCounterIncrement,
  createStorageOperationReporter,
  reportCleanupError,
  planChannelWrite
} from '@migaia/storage-host/sdk'
import type { IStorageJournalAttempt } from '@migaia/storage-host'
import { captureRedisJournalStage, redisJournalTarget, type IRedisJournalStage } from './journal.js'
import type { IRedisConnection, IRedisExecEntry } from './driver.js'
import { redisError, invalidArgument } from './errors.js'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { RedisText, redisExecCause } from './constants.js'
import {
  createRedisLayout,
  RedisSuffix,
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
  /** Journal capture retains the native absolute deadline only when this attempt requests images. */
  readonly originalExpiry?: number
  value: string | undefined
  changed: boolean
  expiry: 'keep' | 'persist' | number
}
/** Selected native HASH points stay in the same original WATCH draft and EXEC. */
export type IRedisHashEntry = {
  readonly physical: string
  readonly lock: Extract<ILockKey, { channel: 'vector' }>
  readonly original: ReadonlyMap<string, Uint8Array>
  /** The original absolute HASH deadline survives later draft TTL edits. */
  readonly originalDeadline: number
  /** Org cleanup observes identity, not vector content; binary Search is not required. */
  readonly identityOnly?: true
  fields: ReadonlyMap<string, Uint8Array>
  deadline: number
  changed: boolean
}
/** One fixed private namespace uses native WATCH identity without a business key or channel. */
export type IRedisJournalHash = {
  readonly physical: string
  readonly original: ReadonlyMap<string, Uint8Array>
  fields: ReadonlyMap<string, Uint8Array>
  changed: boolean
}
/** Binary protocol text is UTF-8; application strings remain with the original JSON codec. */
const utf8 = new TextEncoder(),
  text = new TextDecoder('utf-8', { fatal: true })
/** Native HASH fields are fixed protocol strings, with arbitrary bytes preserved as values. */
export function readRedisHash(reply: unknown): ReadonlyMap<string, Uint8Array> {
  const result = new Map<string, Uint8Array>()
  const add = (key: unknown, value: unknown): void => {
    let field: string | undefined
    try {
      field = typeof key === 'string' ? key : isUint8Array(key) ? text.decode(key) : undefined
    } catch (cause) {
      throw redisError(RedisErrorCode.decodeFailed, cause)
    }
    if (
      field === undefined ||
      result.has(field) ||
      !(typeof value === 'string' || isUint8Array(value))
    )
      throw redisError(RedisErrorCode.decodeFailed, reply)
    result.set(field, typeof value === 'string' ? utf8.encode(value) : value.slice())
  }
  if (Array.isArray(reply)) {
    if (reply.length % 2 !== 0) throw redisError(RedisErrorCode.decodeFailed, reply)
    for (let index = 0; index < reply.length; index += 2) add(reply[index], reply[index + 1])
  } else if (reply && typeof reply === 'object') {
    for (const [key, value] of Object.entries(reply)) add(key, value)
  } else throw redisError(RedisErrorCode.decodeFailed, reply)
  return result
}
/** Native HASH baselines compare original bytes without another application codec. */
function sameHash(
  left: ReadonlyMap<string, Uint8Array>,
  right: ReadonlyMap<string, Uint8Array>
): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    const other = right.get(key)
    if (
      !other ||
      other.length !== value.length ||
      value.some((byte, index) => byte !== other[index])
    )
      return false
  }
  return true
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
  /** Native HASH state belongs to this same transaction draft, never another attempt. */
  readonly hashes = new Map<string, IRedisHashEntry>()
  /** Journal metadata stays in this same native attempt but never enters business publication. */
  readonly journalHashes = new Map<string, IRedisJournalHash>()
  /** Historical native Feature keys are deleted by this original WATCH/EXEC plan. */
  readonly nativeRemovals = new Set<string>()
  /** Original native settlement alone delivers these finite commit/zero-write callbacks. */
  readonly terminal = {
    committed: new Set<() => void>(),
    rolledBack: new Set<() => void>(),
    ended: new Set<() => void>(),
    settled: false
  }
  /** One captured host journal attempt remains attached to this exact native draft. */
  journal?: IStorageJournalAttempt
  /** Ordered accepted mutation facts exist only for the original active journal attempt. */
  readonly journalStages: IRedisJournalStage[] | undefined
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
    guard: (channel: IRedisChannel, key: IStorageKey) => Promise<void>,
    readonly guardVector: (key: Extract<ILockKey, { channel: 'vector' }>) => Promise<void>,
    readonly journalActive = false
  ) {
    this.connection = connection
    this.layout = layout
    this.context = context
    this.send = send
    this.guard = guard
    this.journalStages = journalActive ? [] : undefined
  }
  /** The shared revision HASH is watched before callbacks can read or write a draft. */
  async start(): Promise<void> {
    await this.send([RedisCommand.watch, this.layout.revisions])
  }
  /**
   * WATCH precedes the original HASH parser, so all private head and record reads share one
   * baseline.
   */
  async journalHash(namespace: string): Promise<IRedisJournalHash> {
    const physical = this.layout.journal(namespace),
      existing = this.journalHashes.get(physical)
    if (existing) return existing
    await this.send([RedisCommand.watch, physical])
    const original = readRedisHash(await this.send([RedisCommand.hgetall, physical]))
    const entry = { physical, original, fields: original, changed: false }
    this.journalHashes.set(physical, entry)
    return entry
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
        ...(this.journalActive
          ? { originalExpiry: replyInteger(await this.send([RedisCommand.pexpiretime, physical])) }
          : {}),
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
          ...(this.journalActive
            ? {
                originalExpiry: replyInteger(
                  await this.send([RedisCommand.pexpiretime, physical[index]!])
                )
              }
            : {}),
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
    const expiry =
      ttlMs === undefined ? entry.expiry : ttlMs === 0 ? 0 : (await this.now()) + Math.ceil(ttlMs)
    this.#changeEntry(entry, ttlMs === 0 ? undefined : wire, expiry)
  }
  /** Removal counts actual draft membership; no absent key receives a false mutation count. */
  async remove(channel: IRedisChannel, key: IStorageKey): Promise<boolean> {
    await this.guard(channel, key)
    const entry = await this.load(channel, key)
    if (entry.value === undefined) return false
    this.#changeEntry(entry, undefined)
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
    const expiry = ms === undefined ? 'persist' : ms === 0 ? 0 : (await this.now()) + Math.ceil(ms)
    this.#changeEntry(entry, ms === 0 ? undefined : entry.value, expiry)
    return true
  }
  /**
   * Capture immutable raw before/after images at the actual staging point, then update this same
   * draft.
   */
  #changeEntry(entry: IRedisDraftEntry, value: string | undefined, expiry = entry.expiry): void {
    const deadline = (value: IRedisDraftEntry['expiry']) =>
      value === 'keep' ? entry.originalExpiry : value === 'persist' ? undefined : value
    this.journalStages?.push(
      captureRedisJournalStage({
        target: redisJournalTarget(entry.channel, entry.key),
        revisionField: this.layout.revision(entry.channel, entry.key),
        channel: entry.channel,
        before: entry.value,
        beforeExpiry: deadline(entry.expiry),
        after: value,
        afterExpiry: deadline(expiry)
      })
    )
    entry.value = value
    entry.expiry = expiry
    entry.changed = true
  }
  /**
   * Native vector calls stage through this same HASH owner, preserving cross-channel operation
   * order.
   */
  changeHash(
    entry: IRedisHashEntry,
    fields: ReadonlyMap<string, Uint8Array>,
    deadline = entry.deadline
  ): void {
    this.journalStages?.push(
      captureRedisJournalStage({
        target: entry.lock,
        revisionField: entry.physical,
        channel: 'vector',
        before: entry.fields.size ? entry.fields : undefined,
        beforeExpiry: entry.deadline,
        after: fields.size ? fields : undefined,
        afterExpiry: deadline
      })
    )
    entry.fields = fields
    entry.deadline = deadline
    entry.changed = true
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
  /** WATCH precedes native binary HASH capture and its exact absolute deadline. */
  async hash(
    physical: string,
    lock: Extract<ILockKey, { channel: 'vector' }>
  ): Promise<IRedisHashEntry> {
    const existing = this.hashes.get(physical)
    if (existing) return existing
    if (!this.connection.binaryCommand) throw invalidArgument()
    await this.send([RedisCommand.watch, physical])
    await this.captureRevision(physical)
    const fields = readRedisHash(
      await this.connection.binaryCommand([RedisCommand.hgetall, physical])
    )
    const deadline =
      fields.size === 0 ? 0 : replyInteger(await this.send([RedisCommand.pexpiretime, physical]))
    const entry: IRedisHashEntry = {
      physical,
      lock,
      original: fields,
      originalDeadline: deadline < 0 ? 0 : deadline,
      fields,
      deadline: deadline < 0 ? 0 : deadline,
      changed: false
    }
    this.hashes.set(physical, entry)
    return entry
  }
  /** Fixed managed metadata is textual even when binary vector content cannot be read. */
  async hashIdentity(physical: string): Promise<ReadonlyMap<string, Uint8Array>> {
    const names = [RedisSuffix.vectorId, RedisSuffix.vectorCollection, RedisSuffix.vectorOrg],
      reply = await this.send([RedisCommand.hmget, physical, ...names])
    if (!Array.isArray(reply) || reply.length !== names.length)
      throw redisError(RedisErrorCode.decodeFailed, reply)
    if (reply.every((value) => value === null)) {
      if (replyInteger(await this.send([RedisCommand.exists, physical])) !== 0)
        throw redisError(RedisErrorCode.decodeFailed, reply)
      return new Map()
    }
    return new Map(
      names.map((name, index) => [
        name,
        utf8.encode(
          replyOptionalString(reply[index]) ??
            (() => {
              throw redisError(RedisErrorCode.decodeFailed, reply)
            })()
        )
      ])
    )
  }
  /**
   * Historical managed vectors are removed through this original attempt, even without Search
   * selected.
   */
  async clearVectorOrg(): Promise<void> {
    let cursor = '0'
    do {
      const reply = await this.send([
        RedisCommand.scan,
        cursor,
        RedisCommand.match,
        this.layout.vectorPattern,
        RedisCommand.count,
        '256'
      ])
      if (!Array.isArray(reply) || reply.length !== 2 || !Array.isArray(reply[1]))
        throw redisError(RedisErrorCode.decodeFailed, reply)
      cursor = replyOptionalString(reply[0])!
      if (cursor === undefined) throw redisError(RedisErrorCode.decodeFailed, reply)
      for (const raw of reply[1]) {
        const physical = replyOptionalString(raw)
        if (physical === undefined) throw redisError(RedisErrorCode.decodeFailed, raw)
        const existing = this.hashes.get(physical)
        if (existing) {
          if (existing.fields.size) {
            this.changeHash(existing, new Map())
          }
          continue
        }
        await this.send([RedisCommand.watch, physical])
        await this.captureRevision(physical)
        const metadata = await this.hashIdentity(physical)
        if (!metadata.size) continue
        const id = decodeRedisValue('record', text.decode(metadata.get(RedisSuffix.vectorId))),
          collection = decodeRedisValue(
            'record',
            text.decode(metadata.get(RedisSuffix.vectorCollection))
          ),
          orgId = text.decode(metadata.get(RedisSuffix.vectorOrg))
        if (
          typeof id !== 'string' ||
          typeof collection !== 'string' ||
          orgId !== this.layout.orgId ||
          this.layout.vectorPoint(collection, id) !== physical
        )
          throw redisError(RedisErrorCode.decodeFailed, metadata)
        const key = { channel: 'vector', collection, id } as const
        await this.guardVector(key)
        if (this.journalActive) {
          if (!this.connection.binaryCommand)
            throw new StorageContractError(StorageContractErrorCode.unsupported, {
              backend: RedisText.backend
            })
          const entry = await this.hash(physical, key)
          this.changeHash(entry, new Map())
          continue
        }
        this.hashes.set(physical, {
          physical,
          lock: key,
          original: metadata,
          originalDeadline: 0,
          identityOnly: true,
          fields: new Map(),
          deadline: 0,
          changed: true
        })
      }
    } while (cursor !== '0')
  }
  /** Only known native business layouts participate; shared history and caller-native keys survive. */
  async clearNativeOrg(): Promise<void> {
    for (const channel of [RedisSuffix.streams, RedisSuffix.sorted, RedisSuffix.rate]) {
      let cursor = '0'
      do {
        const reply = await this.send([
          RedisCommand.scan,
          cursor,
          RedisCommand.match,
          this.layout.tag + ':' + channel + ':*',
          RedisCommand.count,
          '256'
        ])
        if (!Array.isArray(reply) || reply.length !== 2 || !Array.isArray(reply[1]))
          throw redisError(RedisErrorCode.decodeFailed, reply)
        cursor = replyOptionalString(reply[0])!
        if (cursor === undefined) throw redisError(RedisErrorCode.decodeFailed, reply)
        for (const raw of reply[1]) {
          const physical = replyOptionalString(raw)
          if (physical === undefined) throw redisError(RedisErrorCode.decodeFailed, raw)
          if (!this.layout.owns(physical)) continue
          let name: IStorageKey
          try {
            name = this.layout.decode(physical.slice(physical.lastIndexOf(':') + 1))
          } catch (cause) {
            reportCleanupError(createStorageOperationReporter(), cause)
            continue
          }
          if (typeof name !== 'string' || this.layout.feature(channel, name) !== physical) continue
          await this.send([RedisCommand.watch, physical])
          if (replyInteger(await this.send([RedisCommand.exists, physical])) !== 0)
            this.nativeRemovals.add(physical)
        }
      } while (cursor !== '0')
    }
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
      if (
        this.journalActive &&
        replyInteger(await this.send([RedisCommand.pexpiretime, entry.physical])) !==
          entry.originalExpiry
      )
        return false
    }
    for (const entry of this.hashes.values()) {
      await this.send([RedisCommand.watch, entry.physical])
      const current = entry.identityOnly
        ? await this.hashIdentity(entry.physical)
        : readRedisHash(
            await this.connection.binaryCommand!([RedisCommand.hgetall, entry.physical])
          )
      if (!sameHash(current, entry.original)) return false
      if (this.journalActive) {
        const deadline = replyInteger(await this.send([RedisCommand.pexpiretime, entry.physical]))
        if ((deadline < 0 ? 0 : deadline) !== entry.originalDeadline) return false
      }
    }
    for (const physical of this.nativeRemovals) {
      await this.send([RedisCommand.watch, physical])
      if (replyInteger(await this.send([RedisCommand.exists, physical])) === 0) return false
    }
    for (const entry of this.journalHashes.values()) {
      await this.send([RedisCommand.watch, entry.physical])
      if (
        !sameHash(
          readRedisHash(await this.send([RedisCommand.hgetall, entry.physical])),
          entry.original
        )
      )
        return false
    }
    for (const channel of this.ranges)
      await this.send([RedisCommand.watch, this.layout.index(channel)])
    return true
  }
  /** Fixed commands retain indexes, values and revisions in one atomic native execution. */
  commands(): IRedisCommand[] {
    const commands: IRedisCommand[] = [...this.nativeRemovals].map((physical) => [
      RedisCommand.del,
      physical
    ])
    for (const entry of this.journalHashes.values()) {
      if (!entry.changed) continue
      /** Retain existing history; only this draft's actual field edits enter the native EXEC. */
      const removed = [...entry.original.keys()].filter((field) => !entry.fields.has(field))
      const updated = [...entry.fields].flatMap(([field, value]) => {
        const previous = entry.original.get(field)
        return previous &&
          previous.length === value.length &&
          value.every((byte, index) => byte === previous[index])
          ? []
          : [field, text.decode(value)]
      })
      if (updated.length) commands.push([RedisCommand.hset, entry.physical, ...updated])
      if (removed.length) commands.push([RedisCommand.hdel, entry.physical, ...removed])
    }
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
    for (const entry of this.hashes.values()) {
      if (!entry.changed) continue
      if (!Number.isSafeInteger(entry.deadline) || entry.deadline < 0) throw invalidArgument()
      commands.push([RedisCommand.del, entry.physical])
      if (entry.fields.size !== 0) {
        commands.push([
          RedisCommand.hset,
          entry.physical,
          ...[...entry.fields].flatMap(([key, value]) => [key, value])
        ])
        if (entry.deadline !== 0)
          commands.push([RedisCommand.pexpireat, entry.physical, String(entry.deadline)])
        else commands.push([RedisCommand.persist, entry.physical])
      }
      commands.push([RedisCommand.hincrby, this.layout.revisions, entry.physical, '1'])
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
