// WATCH-guarded native attempts for the Redis store (see ./store.ts).
import {
  snapshotConcurrencyLockKeys,
  reportCleanupError,
  throwIfAborted
} from '@migaia/storage-host/sdk'
import { RedisCommand, RedisOperation } from './constants.js'
import {
  StorageContractErrorCode,
  type IConcurrencyAttemptContext,
  type IConcurrencyAttempt
} from '@migaia/storage-contract'
import { sleep } from '@migaia/utils/promise'
import { RedisErrorCode } from '@migaia/storage-contract/error-code'
import { RedisDraft, validateRedisExec } from './transaction.js'
import { createRedisLocks, RedisLockConflict } from './locks.js'
import { replyRevision, RedisSuffix } from './layout.js'
import { unsupported, normalizeRedisError, redisError } from './errors.js'
import { RedisText } from './constants.js'
import { encodeRedisChange } from './changes.js'
import type { IRedisConnection } from './driver.js'
import { redisCreateScope } from './store-scope.js'
import {
  redisCommand,
  redisObserve,
  redisConcurrencyStages,
  redisExec,
  redisAssertWrite
} from './store-state.js'
import type { IRedisOrganizationContext } from './store-state.js'
import { redisObservedConnection } from './store-transaction.js'

/** Original native execution state is explicit across WATCH, EXEC and connection unwind. */
type IRedisNativeAttempt<R> = {
  /** The fixed org supplies original native layout and accepted lifetime. */
  organization: IRedisOrganizationContext
  /** Canonical concurrency context owns the unchanged retry and cancellation budget. */
  context: IConcurrencyAttemptContext
  /** The injected driver owns this real connection until native cleanup settles. */
  connection: IRedisConnection
  /** Native command observation uses this same connection and organization. */
  send: (args: readonly string[]) => Promise<unknown>
  /** Original lock evidence remains scoped to this native attempt. */
  locks: ReturnType<typeof createRedisLocks>
  /** Only this draft generates native changes and journal facts. */
  draft: RedisDraft
  /** Known native settlement distinguishes committed and zero-write conflict results. */
  outcome: IConcurrencyAttempt<R> | undefined
  /** The first actual failure survives all native cleanup failures. */
  primary: unknown
  /** Explicit failure state also distinguishes a thrown undefined value. */
  failed: boolean
  /** An issued EXEC with no classified result never emits false rollback effects. */
  ambiguous: boolean
  /** Original journal admission retains its first recorded failure. */
  journalFailure: unknown
  /** Canonical transaction registration owns selected root journal work. */
  journalRegistration:
    | ReturnType<IRedisOrganizationContext['transactionOwner']['register']>
    | undefined
}
/** Prepare native state without issuing commands or replacing the existing driver lease. */
function createRedisNativeAttempt<R>(
  organization: IRedisOrganizationContext,
  context: IConcurrencyAttemptContext,
  connection: IRedisConnection,
  privateJournal: boolean
): IRedisNativeAttempt<R> {
  const send = (args: readonly string[]) =>
      redisCommand(organization.environment, connection, args, organization.orgId),
    locks = createRedisLocks({
      layout: organization.layout,
      context,
      owner: organization.environment.controller.origin,
      label: organization.environment.label,
      maxLockMs: organization.environment.maxLockMs,
      send
    }),
    draft = new RedisDraft(
      redisObservedConnection(organization, connection),
      organization.layout,
      context,
      send,
      locks.guard,
      locks.guardVector,
      !privateJournal && organization.ports.journal?.active() === true
    )
  return {
    organization,
    context,
    connection,
    send,
    locks,
    draft,
    outcome: undefined,
    primary: undefined,
    failed: false,
    ambiguous: false,
    journalFailure: undefined,
    journalRegistration: undefined
  }
}
/** Report only genuine known settlement before native UNWATCH and lock release. */
async function redisCompleteNativeAttempt<R>(attempt: IRedisNativeAttempt<R>): Promise<void> {
  if (attempt.draft.terminal.settled) return
  attempt.draft.terminal.settled = true
  const callbacks =
    attempt.outcome?.status === 'committed'
      ? attempt.draft.terminal.committed
      : attempt.ambiguous
        ? []
        : attempt.draft.terminal.rolledBack
  for (const effect of callbacks)
    redisObserve(attempt.organization.environment, { effect }, 'effect')
  attempt.draft.terminal.committed.clear()
  attempt.draft.terminal.rolledBack.clear()
  try {
    await attempt.draft.journal?.settle?.()
  } catch (cause) {
    reportCleanupError(attempt.organization.environment.report, cause)
  }
}
/** Acquire original locks and establish journal scope before invoking business work. */
async function redisStartNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>,
  scopeOwned: boolean
): Promise<void> {
  await attempt.locks.acquire()
  redisObserve(
    attempt.organization.environment,
    redisConcurrencyStages(attempt.organization),
    'onLockAcquired',
    attempt.context.attempt,
    attempt.context.lock?.length ?? 0
  )
  await attempt.draft.start()
  if (attempt.draft.journalActive && !scopeOwned) {
    const scope = redisCreateScope(attempt.organization, attempt.draft)
    attempt.journalRegistration = attempt.organization.transactionOwner.register(scope, {
      createScope: () => redisCreateScope(attempt.organization, attempt.draft),
      context: attempt.context,
      onFailure: (failure) => {
        attempt.journalFailure ??= failure
      },
      beforeCommit: async (current) => {
        await attempt.draft.journal?.record(current)
      }
    })
    attempt.draft.journal = attempt.organization.ports.journal!.begin(scope)
  }
}
/** Drain root journal work after its original callback, before EXEC can begin. */
async function redisRunNativeCallback<R>(
  attempt: IRedisNativeAttempt<R>,
  run: (draft: RedisDraft) => Promise<R>
): Promise<R> {
  const value = await run(attempt.draft)
  if (attempt.journalRegistration) {
    attempt.journalRegistration.stopAdmission()
    if (attempt.journalFailure !== undefined) throw attempt.journalFailure
    await attempt.journalRegistration.runFinalizers()
  }
  throwIfAborted(attempt.context.signal)
  return value
}
/**
 * Recheck WATCH evidence and classify the four original EXEC outcomes without replaying unknown
 * work.
 */
async function redisCommitNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>,
  value: R
): Promise<void> {
  for (;;) {
    await attempt.locks.verify()
    // EXEC null clears every WATCH, including the guards from the original draft writes.
    for (const entry of attempt.draft.entries.values())
      if (entry.changed) await attempt.locks.guard(entry.channel, entry.key)
    for (const entry of attempt.draft.hashes.values())
      if (entry.changed) await attempt.locks.guardVector(entry.lock)
    throwIfAborted(attempt.context.signal)
    const commands = attempt.draft.commands(),
      changed = [...attempt.draft.entries.values()].filter((entry) => entry.changed)
    let change: ReturnType<typeof encodeRedisChange> | undefined
    if (commands.length === 0) {
      attempt.outcome = { status: 'committed', value }
      break
    }
    if (
      changed.length !== 0 ||
      [...attempt.draft.hashes.values()].some((entry) => entry.changed) ||
      attempt.draft.nativeRemovals.size !== 0
    ) {
      const sequence =
        replyRevision(
          await attempt.send([
            RedisCommand.hget,
            attempt.organization.layout.revisions,
            RedisSuffix.sequence
          ])
        ) + 1
      if (!Number.isSafeInteger(sequence)) throw redisError(RedisErrorCode.decodeFailed)
      change = encodeRedisChange(
        attempt.organization.layout,
        attempt.organization.environment.controller.origin,
        sequence,
        changed,
        [...attempt.draft.hashes.values()].some((entry) => entry.changed) ||
          attempt.draft.nativeRemovals.size !== 0
      )
      commands.push(
        [
          RedisCommand.hset,
          attempt.organization.layout.revisions,
          RedisSuffix.sequence,
          String(sequence)
        ],
        [RedisCommand.publish, attempt.organization.layout.changes, change.wire]
      )
      /** Each change enters the shared Stream (root readers) and its own org Stream (org readers). */
      const durableMaxLen = attempt.organization.environment.durableMaxLen
      if (durableMaxLen !== undefined)
        for (const stream of [
          attempt.organization.layout.durableChanges,
          attempt.organization.layout.orgDurableChanges
        ])
          commands.push([
            RedisCommand.xadd,
            stream,
            RedisCommand.maxlen,
            '~',
            String(durableMaxLen),
            '*',
            RedisSuffix.changeField,
            change.wire
          ])
    }
    throwIfAborted(attempt.context.signal)
    let replies: Awaited<ReturnType<IRedisConnection['exec']>>
    try {
      attempt.ambiguous = true
      replies = await redisExec(
        attempt.organization.environment,
        attempt.connection,
        commands,
        attempt.organization.orgId
      )
    } catch (error) {
      attempt.organization.environment.poison = normalizeRedisError(error)
      throw attempt.organization.environment.poison
    }
    if (replies !== null) {
      try {
        validateRedisExec(replies, commands.length)
      } catch (error) {
        attempt.organization.environment.poison = normalizeRedisError(error)
        throw attempt.organization.environment.poison
      }
      attempt.ambiguous = false
      if (change) attempt.organization.environment.controller.publishExternal(change.change)
      attempt.outcome = { status: 'committed', value }
      break
    }
    attempt.ambiguous = false
    attempt.organization.environment.core.emit(RedisOperation.onWatchConflict, () => ({
      backendId: attempt.organization.environment.core.getBackendId(),
      backend: RedisText.backend,
      orgId: attempt.organization.orgId,
      keyCount:
        attempt.draft.entries.size +
        attempt.draft.ranges.size +
        attempt.draft.hashes.size +
        attempt.draft.nativeRemovals.size
    }))
    await attempt.locks.verify()
    if (!(await attempt.draft.unchanged())) {
      const keys = attempt.context.lock ?? [
        ...[...attempt.draft.hashes.values()].map((entry) => entry.lock),
        ...[...attempt.draft.entries.values()].flatMap((entry) =>
          entry.channel === 'bytes' && typeof entry.key !== 'string'
            ? []
            : snapshotConcurrencyLockKeys(
                [{ channel: entry.channel, key: entry.key }],
                RedisText.backend
              ).keys
        )
      ]
      attempt.outcome = { status: 'conflict', phase: 'commit', keys, holder: undefined }
      break
    }
    redisObserve(
      attempt.organization.environment,
      redisConcurrencyStages(attempt.organization),
      'onRetry',
      attempt.context.attempt,
      1,
      'physical'
    )
    await attempt.context.waitPhysical(sleep(1, { signal: attempt.context.signal }))
  }
}
/** Unwind the real native connection after terminal effects and preserve first-error identity. */
async function redisFinishNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>
): Promise<IConcurrencyAttempt<R>> {
  attempt.journalRegistration?.stopAdmission()
  await redisCompleteNativeAttempt(attempt)
  attempt.journalRegistration?.close()
  const cleanup: unknown[] = []
  try {
    await attempt.send([RedisCommand.unwatch])
  } catch (error) {
    cleanup.push(error)
  }
  try {
    await attempt.locks.release()
    redisObserve(
      attempt.organization.environment,
      redisConcurrencyStages(attempt.organization),
      'onLockReleased',
      attempt.context.attempt,
      attempt.context.lock?.length ?? 0
    )
  } catch (error) {
    cleanup.push(error)
  }
  for (const effect of attempt.draft.terminal.ended)
    redisObserve(attempt.organization.environment, { effect }, 'effect')
  attempt.draft.terminal.ended.clear()
  if (cleanup.length !== 0)
    throw redisError(
      RedisErrorCode.failed,
      new AggregateError(
        attempt.failed ? [attempt.primary, ...cleanup] : cleanup,
        RedisText.failed,
        {
          cause: attempt.failed ? attempt.primary : cleanup[0]
        }
      )
    )
  if (attempt.failed) throw attempt.primary
  return attempt.outcome!
}
/** The native attempt keeps lifecycle, callback, commit and cleanup as separate named jobs. */
async function redisExecuteNativeAttempt<R>(
  attempt: IRedisNativeAttempt<R>,
  run: (draft: RedisDraft) => Promise<R>,
  scopeOwned: boolean
): Promise<IConcurrencyAttempt<R>> {
  try {
    await redisStartNativeAttempt(attempt, scopeOwned)
    const value = await redisRunNativeCallback(attempt, run)
    await redisCommitNativeAttempt(attempt, value)
  } catch (error) {
    if (error instanceof Error && Reflect.get(error, 'code') === StorageContractErrorCode.lockLost)
      redisObserve(
        attempt.organization.environment,
        redisConcurrencyStages(attempt.organization),
        'onLockLost',
        attempt.context.attempt,
        attempt.context.lock?.length ?? 0
      )
    if (error instanceof RedisLockConflict)
      attempt.outcome = {
        status: 'conflict',
        phase: 'acquire',
        keys: error.keys,
        holder: error.holder
      }
    else {
      attempt.failed = true
      attempt.primary = error
    }
  }
  return redisFinishNativeAttempt(attempt)
}
/** The original driver lends exactly one connection until the complete native attempt settles. */
export async function redisNativeAttempt<R>(
  organization: IRedisOrganizationContext,
  context: IConcurrencyAttemptContext,
  run: (draft: RedisDraft) => Promise<R>,
  scopeOwned = false,
  privateJournal = false
): Promise<IConcurrencyAttempt<R>> {
  redisAssertWrite(organization.environment)
  if (
    context.lock?.some(
      (key) =>
        key.channel === 'rdf' ||
        (key.channel === 'vector' && !organization.environment.vectorFactory)
    )
  )
    unsupported()
  return organization.environment.driver.withConnection((connection) =>
    redisExecuteNativeAttempt(
      createRedisNativeAttempt<R>(organization, context, connection, privateJournal),
      run,
      scopeOwned
    )
  )
}
