// Write execution, locks and captured entries for the Redis store (see ./store.ts).
import {
  runWithConcurrency,
  snapshotConcurrencyLockKeys,
  resolveConcurrencyPolicy,
  snapshotStorageKey,
  createStorageBatchKeyCapture,
  snapshotStorageOrgKeyPrefix
} from '@migaia/storage-host/sdk'
import {
  assertStringStorageKey,
  assertStorageTtlDuration,
  assertOperationContext,
  type IStorageKey,
  type IKeyRange,
  type IOperationContext,
  type IWriteOptions,
  type IConcurrencyAttemptContext,
  type ILockKey,
  type IConcurrencyPolicy
} from '@migaia/storage-contract'
import { isUint8Array } from '@migaia/utils/bytes'
import { RedisDraft } from './transaction.js'
import { redisHex, encodeRedisValue, decodeRedisValue, type IRedisChannel } from './layout.js'
import { invalidArgument } from './errors.js'
import { RedisText } from './constants.js'
import { redisNativeAttempt } from './store-native-attempt.js'
import { redisOperate, redisAssertWrite } from './store-state.js'
import type { IRedisOrganizationContext, IRedisTextInput, IRedisValueInput } from './store-state.js'

/** Original draft facts expose canonical point identities without retaining another key set. */
export function redisDraftKeys(
  organization: IRedisOrganizationContext,
  draft: RedisDraft
): readonly ILockKey[] {
  return snapshotConcurrencyLockKeys(
    [
      ...[...draft.entries.values()].flatMap((entry) =>
        entry.channel === 'bytes' && typeof entry.key !== 'string'
          ? []
          : [{ channel: entry.channel, key: entry.key }]
      ),
      ...[...draft.hashes.values()].map((entry) => entry.lock)
    ],
    RedisText.backend
  ).keys
}
/** One logical root write retains prepared input and actual native observation across attempts. */
type IRedisWriteExecution<I, P, R> = {
  /** Original organization belongs to this accepted logical write, not another attempt. */
  organization: IRedisOrganizationContext
  /** Original name belongs to this accepted logical write, not another attempt. */
  name: string
  /** Original input belongs to this accepted logical write, not another attempt. */
  input: I
  /** Original ctx belongs to this accepted logical write, not another attempt. */
  ctx: IOperationContext | undefined
  /** Original capture belongs to this accepted logical write, not another attempt. */
  capture: (input: I) => P
  /** Original keys belongs to this accepted logical write, not another attempt. */
  keys: (input: P) => readonly ILockKey[]
  /** Original run belongs to this accepted logical write, not another attempt. */
  run: (draft: RedisDraft, input: P, context: IConcurrencyAttemptContext) => Promise<R>
  /** Original count belongs to this accepted logical write, not another attempt. */
  count: number | undefined
  /** Original policy belongs to this accepted logical write, not another attempt. */
  policy: IConcurrencyPolicy | undefined
  /** Original finish belongs to this accepted logical write, not another attempt. */
  finish: () => void
  /** Original actual belongs to this accepted logical write, not another attempt. */
  actual: P
  /** Original observedInput belongs to this accepted logical write, not another attempt. */
  observedInput: I
  /** Original observedDraft belongs to this accepted logical write, not another attempt. */
  observedDraft: RedisDraft | undefined
  /** Original observing belongs to this accepted logical write, not another attempt. */
  observing: boolean
}
/** Execute the original pipeline/concurrency loop using only this explicit logical write state. */
function redisExecuteWrite<I, P, R>(execution: IRedisWriteExecution<I, P, R>): Promise<R> {
  return runWithConcurrency<R>(
    {
      store: execution.organization.store,
      options: execution.ctx ?? {},
      policy: execution.policy,
      ...(execution.organization.ports.journal === undefined
        ? {}
        : { prepare: () => execution.organization.ports.journal!.prepare() }),
      execute: (context, proceed) =>
        redisOperate<I, Awaited<R>>(
          execution.organization,
          execution.name,
          execution.input,
          context,
          undefined,
          async (prepared): Promise<Awaited<R>> => {
            execution.observedInput = prepared
            execution.actual = execution.capture(prepared)
            return (await proceed()) as Awaited<R>
          },
          execution.count,
          undefined,
          true
        ),
      lock: () => execution.keys(execution.actual)
    },
    {
      attempt: (context) =>
        redisNativeAttempt(execution.organization, context, (draft) => {
          if (execution.observing) execution.observedDraft = draft
          return execution.run(draft, execution.actual, context)
        })
    }
  ).finally(execution.finish)
}
/** Keep completion telemetry on the original execution observer and exact final native draft. */
function redisObserveWrite<I, P, R>(execution: IRedisWriteExecution<I, P, R>): Promise<R> {
  return execution.organization.ports.execution.observe === undefined
    ? redisExecuteWrite(execution)
    : execution.organization.ports.execution.observe(
        () => ({
          operation: execution.name,
          input: execution.observedInput,
          ctx: execution.ctx,
          keys: () =>
            execution.observedDraft === undefined
              ? []
              : redisDraftKeys(execution.organization, execution.observedDraft)
        }),
        (enabled) => {
          execution.observing = enabled
          return redisExecuteWrite(execution)
        }
      )
}
/** Admit one root write, then preserve its original native lifetime until all cleanup settles. */
export function redisWrite<I, P, R>(
  organization: IRedisOrganizationContext,
  name: string,
  input: I,
  ctx: IOperationContext | undefined,
  capture: (input: I) => P,
  keys: (input: P) => readonly ILockKey[],
  run: (draft: RedisDraft, input: P, context: IConcurrencyAttemptContext) => Promise<R>,
  count?: number,
  policy?: IConcurrencyPolicy
): Promise<R> {
  redisAssertWrite(organization.environment)
  const execution: IRedisWriteExecution<I, P, R> = {
    organization,
    name,
    input,
    ctx,
    capture,
    keys,
    run,
    count,
    policy,
    finish: organization.environment.controller.beginMutation(),
    actual: undefined!,
    observedInput: input,
    observedDraft: undefined,
    observing: false
  }
  return redisObserveWrite(execution)
}

/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
export function redisKey(organization: IRedisOrganizationContext, input: IStorageKey): IStorageKey {
  return snapshotStorageKey(input, RedisText.backend)
}
/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
export function redisTextKey(organization: IRedisOrganizationContext, input: string): string {
  assertStringStorageKey(input, RedisText.backend)
  return input
}
/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
export function redisChannelLocks(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: IStorageKey
): readonly ILockKey[] {
  return snapshotConcurrencyLockKeys([{ channel, key: input }], RedisText.backend).keys
}
/**
 * Every caller key is detached by the original domain owner before any native connection is
 * borrowed.
 */
export function redisWriteLocks(
  organization: IRedisOrganizationContext,
  input: IStorageKey
): readonly ILockKey[] {
  return snapshotConcurrencyLockKeys(
    [
      { channel: 'text', key: input },
      { channel: 'record', key: input },
      ...(typeof input === 'string' ? [{ channel: 'bytes', key: input }] : [])
    ],
    RedisText.backend
  ).keys
}
/**
 * Public empty batches validate pure options but allocate no pipeline, timer, hook or native
 * attempt.
 */
export function redisEmpty<R>(
  organization: IRedisOrganizationContext,
  ctx: IOperationContext | undefined,
  value: R
): Promise<R> {
  organization.environment.controller.assertLive()
  assertOperationContext(ctx)
  const policy = (ctx as IWriteOptions | undefined)?.concurrency
  if (policy !== undefined) resolveConcurrencyPolicy(organization.store, policy)
  return Promise.resolve(value)
}
/** Complete batch value capture retains one array length and each caller field value exactly once. */
export function redisCaptureEntries(
  organization: IRedisOrganizationContext,
  entries: readonly {
    readonly key: IStorageKey
    readonly value: string
    readonly ttlMs?: number
  }[]
): readonly IRedisTextInput[] {
  if (!Array.isArray(entries)) throw invalidArgument()
  const count = entries.length,
    capture = createStorageBatchKeyCapture(RedisText.backend),
    captured: IRedisTextInput[] = []
  for (let index = 0; index < count; index++) {
    const entry = entries[index]
    if (!entry || typeof entry !== 'object') throw invalidArgument()
    const capturedKey = capture(entry.key),
      value = entry.value,
      ttlMs = entry.ttlMs
    if (capturedKey.firstIndex !== index) throw invalidArgument()
    if (ttlMs !== undefined) assertStorageTtlDuration(ttlMs, RedisText.backend)
    if (typeof value !== 'string') throw invalidArgument()
    captured.push({ key: capturedKey.key, value, ...(ttlMs === undefined ? {} : { ttlMs }) })
  }
  return captured
}
/** Stage replacement is captured completely and encoded before its first native read or lock check. */
export function redisPrepareEntries(
  organization: IRedisOrganizationContext,
  entries: readonly IRedisTextInput[]
): readonly IRedisValueInput[] {
  return redisCaptureEntries(organization, entries).map((entry) => ({
    key: entry.key,
    wire: encodeRedisValue('text', entry.value),
    ...(entry.ttlMs === undefined ? {} : { ttlMs: entry.ttlMs })
  }))
}
/** Pure capture detaches caller-owned records and bytes before any asynchronous pipeline can wait. */
export function redisCapturePoint(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: IStorageKey,
  value: unknown
): { readonly key: IStorageKey; readonly value: unknown } {
  const capturedKey = redisKey(organization, input)
  if (channel === 'bytes') {
    if (!isUint8Array(value)) throw invalidArgument()
    return { key: capturedKey, value: new Uint8Array(value) }
  }
  if (channel === 'text') {
    if (typeof value !== 'string') throw invalidArgument()
    return { key: capturedKey, value }
  }
  return {
    key: capturedKey,
    value: decodeRedisValue('record', encodeRedisValue('record', value))
  }
}
/** Native facts are derived from the actual stage input as one inseparable key/value pair. */
export function redisPreparePoint(
  organization: IRedisOrganizationContext,
  channel: IRedisChannel,
  input: { readonly key: IStorageKey; readonly value: unknown }
): { readonly key: IStorageKey; readonly wire: string } {
  const capturedKey = redisKey(organization, input.key)
  if (channel === 'bytes' && !isUint8Array(input.value)) throw invalidArgument()
  return { key: capturedKey, wire: encodeRedisValue(channel, input.value) }
}
/** The original org key range maps directly to native lex bounds without splicing encoded tags. */
export function redisBounds(
  organization: IRedisOrganizationContext,
  range?: IKeyRange,
  prefixKey?: IStorageKey
): readonly [string, string] {
  const all = snapshotStorageOrgKeyPrefix(organization.orgId, prefixKey, RedisText.backend)
  return [
    range?.lower === undefined
      ? '[' + redisHex(all.lower)
      : (range.lowerOpen ? '(' : '[') + organization.layout.encode(range.lower),
    range?.upper === undefined
      ? '(' + redisHex(all.upper)
      : (range.upperOpen ? '(' : '[') + organization.layout.encode(range.upper)
  ]
}
