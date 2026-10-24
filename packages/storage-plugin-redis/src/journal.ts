import { type ITransactionScope, type IStorageKey, type ILockKey } from '@migaia/storage-contract'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalChange,
  IStorageJournalImage,
  IStorageJournalNamespace,
  IStorageJournalNamespaceView
} from '@migaia/storage-host'
import { subscriptionResource } from './native.js'
import { encodeRedisValue, type IRedisChannel } from './layout.js'
import { invalidArgument, unsupported } from './errors.js'
import type { RedisDraft } from './transaction.js'

/** Original portable wire and native absolute TTL form one opaque diagnostic journal image. */
function image(
  channel: IRedisChannel | 'vector',
  value: unknown,
  expiresAt: number | undefined
): IStorageJournalImage {
  return value === undefined
    ? Object.freeze({ present: false })
    : Object.freeze({
        present: true,
        value: encodeRedisValue('record', {
          version: 1,
          channel,
          value,
          expiresAt: expiresAt !== undefined && expiresAt > 0 ? expiresAt : null
        })
      })
}
/** Each already-canonical business key retains its actual channel in the original journal. */
export function redisJournalTarget(channel: IRedisChannel, key: IStorageKey): ILockKey {
  if (channel === 'bytes') {
    if (typeof key !== 'string') throw invalidArgument()
    return { channel, key }
  }
  return { channel, key }
}
/**
 * Each ordered fact retains immutable opaque images; final revision remains the original native
 * owner's fact.
 */
export type IRedisJournalStage = Readonly<
  Omit<IStorageJournalChange, 'afterRevision'> & { revisionField: string }
>
/** Capture one actual native draft mutation before another call can replace its intermediate state. */
export function captureRedisJournalStage(input: {
  readonly target: ILockKey
  readonly revisionField: string
  readonly channel: IRedisChannel | 'vector'
  readonly before: unknown
  readonly beforeExpiry?: number
  readonly after: unknown
  readonly afterExpiry?: number
}): IRedisJournalStage {
  return Object.freeze({
    target: input.target,
    revisionField: input.revisionField,
    before: image(input.channel, input.before, input.beforeExpiry),
    after: image(input.channel, input.after, input.afterExpiry)
  })
}
/** Fixed-org terminal access has no native rollback or resource-long exclusive index guarantee. */
export function createRedisJournalBinding(input: {
  readonly forOrg: (orgId: string) => IStorageJournalBackendBinding
  readonly assertLive: () => void
  readonly state: (scope: Omit<ITransactionScope, 'use'>) => {
    readonly draft: RedisDraft
    readonly info: ReturnType<typeof import('@migaia/storage-contract').assertTransactionOwner>
  }
}): IStorageJournalBackendBinding {
  return {
    forOrg: input.forOrg,
    openNamespace: async (prefix): Promise<IStorageJournalNamespace> => {
      input.assertLive()
      if (typeof prefix !== 'string' || prefix.length === 0) throw invalidArgument()
      const lifetime = subscriptionResource(async () => undefined)
      const live = (): void => {
        input.assertLive()
        if (lifetime.isClosing()) unsupported()
      }
      return {
        ...lifetime.resource,
        nativeAtomic: false,
        indexExclusive: false,
        assertLive: live,
        transactionInfo: (scope) => {
          live()
          return input.state(scope).info
        },
        run: async <R>(_work: (view: IStorageJournalNamespaceView) => Promise<R>): Promise<R> =>
          unsupported(),
        onCommit: (scope, effect) => {
          live()
          if (typeof effect !== 'function') throw invalidArgument()
          const callbacks = input.state(scope).draft.terminal.committed
          callbacks.add(effect)
          return () => {
            callbacks.delete(effect)
          }
        },
        onRollback: (scope, effect) => {
          live()
          if (typeof effect !== 'function') throw invalidArgument()
          const callbacks = input.state(scope).draft.terminal.rolledBack
          callbacks.add(effect)
          return () => {
            callbacks.delete(effect)
          }
        }
      }
    },
    changes: (scope): readonly IStorageJournalChange[] => {
      const { draft } = input.state(scope)
      return Object.freeze(
        (draft.journalStages ?? []).map((stage) =>
          Object.freeze({
            target: stage.target,
            before: stage.before,
            after: stage.after,
            afterRevision: String(BigInt(draft.revisions.get(stage.revisionField) ?? 0) + 1n)
          })
        )
      )
    }
  }
}
