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
function target(channel: IRedisChannel, key: IStorageKey): ILockKey {
  if (channel === 'bytes') {
    if (typeof key !== 'string') throw invalidArgument()
    return { channel, key }
  }
  return { channel, key }
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
      const { draft } = input.state(scope),
        changes: IStorageJournalChange[] = []
      for (const entry of draft.entries.values()) {
        if (!entry.changed) continue
        changes.push(
          Object.freeze({
            target: target(entry.channel, entry.key),
            before: image(entry.channel, entry.original, entry.originalExpiry),
            after: image(
              entry.channel,
              entry.value,
              entry.expiry === 'keep'
                ? entry.originalExpiry
                : entry.expiry === 'persist'
                  ? undefined
                  : entry.expiry
            ),
            afterRevision: String(
              BigInt(draft.revisions.get(draft.layout.revision(entry.channel, entry.key)) ?? 0) + 1n
            )
          })
        )
      }
      for (const entry of draft.hashes.values()) {
        if (!entry.changed) continue
        changes.push(
          Object.freeze({
            target: entry.lock,
            before: image(
              'vector',
              entry.original.size ? entry.original : undefined,
              entry.originalDeadline
            ),
            after: image('vector', entry.fields.size ? entry.fields : undefined, entry.deadline),
            afterRevision: String(BigInt(draft.revisions.get(entry.physical) ?? 0) + 1n)
          })
        )
      }
      return Object.freeze(changes)
    }
  }
}
