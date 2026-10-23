import { createRuntime } from '@migaia/reactive'
import { defineEntity } from '@migaia/storage-host/entity'
import type { IChangeFeedStore, ICodec, IRecordStore } from '@migaia/storage-contract'
import { createManualScheduler } from '@migaia/utils/testing'
import { walkErrorCauses } from '@migaia/utils/error'
import { defaultJsonCodec, persistTransaction, persistUnit, readEnvelope } from '../../src/index.js'

/** Both actual native backends expose their original commit-only notification channel. */
type INativeStore = IRecordStore & IChangeFeedStore

/** A synchronous application unit keeps its actual memory independently of native rollback. */
function counterUnit() {
  /** The same mutable object makes delayed snapshot conversion observable. */
  const state = { count: 0 }
  /** Only the persistence attachment owns this original subscription. */
  let changed = (): void => undefined
  return {
    state,
    unit: {
      snapshot: () => state,
      restore: (value: typeof state) => Object.assign(state, value),
      subscribe: (notify: () => void) => {
        changed = notify
        return () => {
          changed = () => undefined
        }
      }
    },
    change: (count: number) => {
      state.count = count
      changed()
    }
  }
}

/**
 * Drive the same public persistence/entity workflow in memory and the original browser runner.
 * Error identity is compared inside the owning realm before plain evidence leaves the fixture. The
 * caller owns and disposes the actual store; this attachment never closes it.
 */
export async function runPersistNativeConsumerScenario(storage: INativeStore) {
  /** Manual time advances only the existing persistence debounce, never native transaction time. */
  const scheduler = createManualScheduler()
  /** Real entity indexes are intentionally cold when the first transaction begins. */
  const repo = defineEntity<{ id: string; email: string }>()({
    name: 'persist-native-users',
    key: 'id',
    indexes: { email: { path: 'email', unique: true } }
  }).connect(storage)
  /** This actual mutable unit remains changed after rollback. */
  const value = counterUnit()
  /** The default production codec must stay on the native active request chain. */
  const handle = persistUnit(value.unit, {
    key: 'persist-native-counter',
    storage,
    runtime: createRuntime(),
    scheduler,
    debounceMs: 100
  })
  await handle.ready
  await handle.flush()
  try {
    /** A callback result proves the original transaction result reaches the public coordinator. */
    const result = await persistTransaction(storage, [handle], async (tx) => {
      value.change(1)
      await handle.flush(tx)
      await repo.in(tx).put({ id: 'committed', email: 'one' })
      await tx.set('persist-native-business', 'committed')
      return 'committed' as const
    })
    /** All committed channels are read through their public original root entries. */
    const committed = {
      result,
      envelope: await readEnvelope(storage, 'persist-native-counter', defaultJsonCodec, {}),
      entity: await repo.get('committed'),
      business: await storage.get('persist-native-business')
    }
    /** This exact user failure must remain reachable through backend normalization. */
    const primary = new Error('persist native rollback fixture')
    /** The first rejected native transaction must not turn its flush into a root write. */
    const failure = await persistTransaction(storage, [handle], async (tx) => {
      value.change(2)
      await handle.flush(tx)
      await repo.in(tx).put({ id: 'rolled-back', email: 'two' })
      await tx.set('persist-native-rolled-back', 'uncommitted')
      throw primary
    }).catch((cause: unknown) => cause)
    /** These reads happen before the original debounce is advanced. */
    const rolledBack = {
      primaryReachable: walkErrorCauses(failure).includes(primary),
      envelope: await readEnvelope(storage, 'persist-native-counter', defaultJsonCodec, {}),
      entity: await repo.get('rolled-back'),
      business: await storage.get('persist-native-rolled-back'),
      memory: value.state.count,
      writeErrorSame: handle.writeError.value === failure
    }
    /** The existing commit feed acknowledges automatic mirroring without calling handle.flush(). */
    await mirror()
    /** Rollback leaves application memory intact and resumes its ordinary persistence timer. */
    const mirrored = await readEnvelope(storage, 'persist-native-counter', defaultJsonCodec, {})
    /** A cold unique index remains the actual final-state authority for this same native scope. */
    const uniqueFailure = await persistTransaction(storage, [handle], async (tx) => {
      value.change(3)
      await handle.flush(tx)
      await repo.in(tx).put({ id: 'duplicate', email: 'one' })
    }).catch((cause: unknown) => cause)
    /** The conflicting entity and snapshot both remain absent until normal mirroring resumes. */
    const unique = {
      code: (uniqueFailure as { readonly code?: string }).code,
      envelope: await readEnvelope(storage, 'persist-native-counter', defaultJsonCodec, {}),
      entity: await repo.get('duplicate'),
      memory: value.state.count
    }
    await mirror()
    /** The caller's original abort reason belongs to the same one native transaction attempt. */
    const controller = new AbortController()
    /** Identity is checked locally before serialization by the browser fixture. */
    const reason = new Error('persist native cancellation fixture')
    /** Cancellation happens after both real requests, so rollback cannot be a vacuous assertion. */
    const cancelledFailure = await persistTransaction(
      storage,
      [handle],
      async (tx) => {
        value.change(4)
        await handle.flush(tx)
        await repo.in(tx).put({ id: 'cancelled', email: 'four' })
        controller.abort(reason)
      },
      { signal: controller.signal }
    ).catch((cause: unknown) => cause)
    /** Native rollback settles before the coordinator resumes the attachment's normal timer. */
    const cancelled = {
      reasonReachable: walkErrorCauses(cancelledFailure).includes(reason),
      envelope: await readEnvelope(storage, 'persist-native-counter', defaultJsonCodec, {}),
      entity: await repo.get('cancelled'),
      memory: value.state.count
    }
    await mirror()
    /** A caller may restore application memory after the failed native transaction settles. */
    const restoredPrimary = new Error('persist caller restoration fixture')
    /** The expected rejected outcome remains explicit evidence rather than a swallowed failure. */
    let restorationFailure: unknown
    try {
      await persistTransaction(storage, [handle], async (tx) => {
        value.change(5)
        await handle.flush(tx)
        await repo.in(tx).put({ id: 'restored', email: 'five' })
        throw restoredPrimary
      })
    } catch (cause) {
      restorationFailure = cause
      value.change(4)
    }
    await mirror()
    return {
      committed,
      rolledBack,
      mirrored,
      unique,
      cancelled,
      restored: {
        primaryReachable: walkErrorCauses(restorationFailure).includes(restoredPrimary),
        envelope: await readEnvelope(storage, 'persist-native-counter', defaultJsonCodec, {}),
        entity: await repo.get('restored'),
        memory: value.state.count
      }
    }
  } finally {
    await handle.disposeAsync()
  }

  /** Advance only the original queued debounce and wait for its actual native commit notification. */
  async function mirror(): Promise<void> {
    /** The native feed resolves only after the restored background write genuinely commits. */
    const committed = Promise.withResolvers<void>()
    /** This fixture owns only this finite notification subscription. */
    const unsubscribe = storage.subscribeChanges((change) => {
      if (change.channel === 'value' && change.keys?.includes('persist-native-counter'))
        committed.resolve()
    })
    try {
      scheduler.advance(100)
      await committed.promise
    } finally {
      unsubscribe()
    }
  }
}

/** The native browser must reject a codec that crosses a task; memory supports that same codec. */
export async function runPersistCrossTaskCodecScenario(storage: IRecordStore) {
  /** This actual unit participates in the public coordinator rather than a structural handle. */
  const value = counterUnit()
  /** Moving conversion past a timer deliberately exercises the browser's genuine active window. */
  const codec: ICodec = {
    name: 'persist-cross-task-fixture',
    output: 'text',
    encode: async (envelope) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      return defaultJsonCodec.encode(envelope)
    },
    decode: (text) => defaultJsonCodec.decode(text)
  }
  /** The pending ordinary mirror stays controlled until the actual transaction result is read. */
  const scheduler = createManualScheduler()
  /** Native transaction lifetime remains the original backend's responsibility. */
  const crossing = persistUnit(value.unit, {
    key: 'persist-cross-task-codec',
    storage,
    runtime: createRuntime(),
    codec,
    scheduler,
    debounceMs: 100
  })
  await crossing.ready
  await crossing.flush()
  /** The inner operation's exact error is compared with the final native transaction failure. */
  let operationFailure: unknown
  try {
    /** A real earlier request proves native inactivity rolls the whole attempt back. */
    const failure = await persistTransaction(storage, [crossing], async (tx) => {
      value.change(1)
      await tx.set('persist-cross-task-business', 'during')
      try {
        await crossing.flush(tx)
      } catch (cause) {
        operationFailure = cause
      }
    }).then(
      () => undefined,
      (cause: unknown) => cause
    )
    return {
      failed: failure !== undefined,
      code: (failure as { readonly code?: string } | undefined)?.code,
      causeName: ((failure as Error | undefined)?.cause as Error | undefined)?.name,
      operationAndOuterSame: operationFailure !== undefined && operationFailure === failure,
      envelope: await readEnvelope(storage, 'persist-cross-task-codec', codec, {}),
      business: await storage.get('persist-cross-task-business'),
      memory: value.state.count
    }
  } finally {
    await crossing.disposeAsync()
  }
}
