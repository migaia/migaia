import {
  assertStringStorageKey,
  type ITransactionScope,
  type IStorageKey,
  type ILockKey
} from '@migaia/storage-contract'
import type {
  IStorageJournalBackendBinding,
  IStorageJournalChange,
  IStorageJournalImage,
  IStorageJournalNamespace,
  IStorageJournalNamespaceView
} from '@migaia/storage-host'
import {
  createBackendJournalNamespace,
  type IBackendJournalTransaction,
  type IBackendChangeController
} from '@migaia/storage-host/authoring/backend'
import { encodeRedisValue, decodeRedisValue, type IRedisChannel } from './layout.js'
import { invalidArgument } from './errors.js'
import { RedisText } from './constants.js'
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
  readonly controller: Pick<IBackendChangeController, 'beginMutation' | 'closingSignal'>
  readonly report: (error: unknown) => void
  readonly run: <R>(work: (draft: RedisDraft) => Promise<R>) => Promise<R>
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
      const port = (draft: RedisDraft): IBackendJournalTransaction => {
        const listen = (effects: Set<() => void>, effect: () => void) => {
          effects.add(effect)
          return () => {
            effects.delete(effect)
          }
        }
        const key = (value: unknown): string => {
          assertStringStorageKey(value, RedisText.backend)
          return draft.layout.encode(value)
        }
        const execute = async <R>(run: () => Promise<R>): Promise<R> => {
          if (draft.terminal.settled) throw invalidArgument()
          return run()
        }
        const clear = () =>
          execute(async () => {
            const entry = await draft.journalHash(prefix)
            entry.fields = new Map()
            entry.changed = true
          })
        const view: IStorageJournalNamespaceView = Object.freeze({
          get: (name) =>
            execute(async () => {
              const field = key(name),
                value = (await draft.journalHash(prefix)).fields.get(field)
              return value === undefined
                ? null
                : (decodeRedisValue('text', new TextDecoder().decode(value)) as string)
            }),
          has: (name) =>
            execute(async () => (await draft.journalHash(prefix)).fields.has(key(name))),
          set: (name, value) =>
            execute(async () => {
              const field = key(name),
                wire = new TextEncoder().encode(encodeRedisValue('text', value)),
                entry = await draft.journalHash(prefix)
              const fields = new Map(entry.fields)
              fields.set(field, wire)
              entry.fields = fields
              entry.changed = true
            }),
          remove: (name) =>
            execute(async () => {
              const field = key(name),
                entry = await draft.journalHash(prefix),
                fields = new Map(entry.fields)
              if (fields.delete(field)) {
                entry.fields = fields
                entry.changed = true
              }
            }),
          keys: () =>
            execute(async () =>
              [...(await draft.journalHash(prefix)).fields.keys()].map((field) => {
                const name = draft.layout.decode(field)
                if (typeof name !== 'string') throw invalidArgument()
                return name
              })
            ),
          clearValues: clear,
          clearAll: clear
        })
        return {
          run: async (work) => {
            await draft.journalHash(prefix)
            return work(view)
          },
          onCommit: (effect) => listen(draft.terminal.committed, effect),
          onRollback: (effect) => listen(draft.terminal.rolledBack, effect),
          onEnd: (effect) => listen(draft.terminal.ended, effect)
        }
      }
      return createBackendJournalNamespace({
        assertLive: input.assertLive,
        closingSignal: input.controller.closingSignal,
        report: input.report,
        nativeAtomic: false,
        indexExclusive: false,
        reserve: async (hold) => {
          const release = input.controller.beginMutation()
          try {
            await hold()
          } finally {
            release()
          }
        },
        authenticate: (scope) => {
          const state = input.state(scope)
          return { info: state.info, port: port(state.draft) }
        },
        transaction: (work) => input.run((draft) => work(port(draft)))
      })
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
