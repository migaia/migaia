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
} from '@migaia/storage-host/sdk'
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
    ? { present: false }
    : {
        present: true,
        value: encodeRedisValue('record', {
          version: 1,
          channel,
          value,
          expiresAt: expiresAt !== undefined && expiresAt > 0 ? expiresAt : null
        })
      }
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
  return {
    target: input.target,
    revisionField: input.revisionField,
    before: image(input.channel, input.before, input.beforeExpiry),
    after: image(input.channel, input.after, input.afterExpiry)
  }
}
/** Native namespace fields reuse this original draft and never create a business channel. */
class RedisJournalView implements IStorageJournalNamespaceView {
  /** The exact WATCH draft authenticates native terminal state. */
  readonly #draft: RedisDraft
  /** One fixed namespace maps to its original private HASH. */
  readonly #prefix: string
  /** Capture namespace identity inside the canonical journal transaction. */
  constructor(draft: RedisDraft, prefix: string) {
    this.#draft = draft
    this.#prefix = prefix
  }
  /** Reject post-settlement operations before reading or staging native facts. */
  async #execute<R>(run: () => Promise<R>): Promise<R> {
    if (this.#draft.terminal.settled) throw invalidArgument()
    return run()
  }
  /** Only the canonical layout turns a validated namespace field into native identity. */
  #key(value: unknown): string {
    assertStringStorageKey(value, RedisText.backend)
    return this.#draft.layout.encode(value)
  }
  /** Read the current same-draft field and original portable text wire. */
  readonly get = (name: string) =>
    this.#execute(async () => {
      /** Native admission has already fixed this field before the HASH read can await. */
      const field = this.#key(name),
        value = (await this.#draft.journalHash(this.#prefix)).fields.get(field)
      return value === undefined
        ? null
        : (decodeRedisValue('text', new TextDecoder().decode(value)) as string)
    })
  /** Membership uses the same original native HASH and field codec. */
  readonly has = (name: string) =>
    this.#execute(async () =>
      (await this.#draft.journalHash(this.#prefix)).fields.has(this.#key(name))
    )
  /** Stage a field delta in the same EXEC without replacing historical namespace entries. */
  readonly set = (name: string, value: string) =>
    this.#execute(async () => {
      /** Portable bytes detach the value before the native WATCH read yields. */
      const field = this.#key(name),
        wire = new TextEncoder().encode(encodeRedisValue('text', value)),
        entry = await this.#draft.journalHash(this.#prefix)
      /** This replacement map keeps prior ordered journal facts independent of later edits. */
      const fields = new Map(entry.fields)
      fields.set(field, wire)
      entry.fields = fields
      entry.changed = true
    })
  /** Stage only an existing field's removal in this original draft. */
  readonly remove = (name: string) =>
    this.#execute(async () => {
      /** Native field identity is fixed before the original HASH read. */
      const field = this.#key(name),
        entry = await this.#draft.journalHash(this.#prefix),
        fields = new Map(entry.fields)
      if (fields.delete(field)) {
        entry.fields = fields
        entry.changed = true
      }
    })
  /** Decode every actual private field through the one organization layout. */
  readonly keys = () =>
    this.#execute(async () =>
      [...(await this.#draft.journalHash(this.#prefix)).fields.keys()].map((field) => {
        /** Persisted namespace field corruption keeps the existing argument error. */
        const name = this.#draft.layout.decode(field)
        if (typeof name !== 'string') throw invalidArgument()
        return name
      })
    )
  /** Clear only this private namespace in the original native draft. */
  readonly clearValues = () =>
    this.#execute(async () => {
      const entry = await this.#draft.journalHash(this.#prefix)
      entry.fields = new Map()
      entry.changed = true
    })
  /** The private namespace has one value channel, so both clear methods use the same job. */
  readonly clearAll = this.clearValues
}
/** Add one original terminal effect and return its exact removal callback. */
function listenRedisJournal(effects: Set<() => void>, effect: () => void): () => void {
  effects.add(effect)
  return () => {
    effects.delete(effect)
  }
}
/** A transaction view holds fixed namespace identity and borrows the original settlement effects. */
class RedisJournalTransaction implements IBackendJournalTransaction {
  /** Original draft owns native state and settlement. */
  readonly #draft: RedisDraft
  /** The namespace has no lifetime beyond its original native transaction. */
  readonly #prefix: string
  /** One view preserves the original identity across work callbacks. */
  readonly #view: RedisJournalView
  /** Prepare a finite view without native work or another lifecycle owner. */
  constructor(draft: RedisDraft, prefix: string) {
    this.#draft = draft
    this.#prefix = prefix
    this.#view = new RedisJournalView(draft, prefix)
  }
  /** WATCH/load precedes the caller's namespace work in this same transaction. */
  readonly run = async <R>(
    work: (view: IStorageJournalNamespaceView) => Promise<R>
  ): Promise<R> => {
    await this.#draft.journalHash(this.#prefix)
    return work(this.#view)
  }
  /** Commit effects observe only known successful native settlement. */
  readonly onCommit = (effect: () => void) =>
    listenRedisJournal(this.#draft.terminal.committed, effect)
  /** Rollback effects observe only known zero-write outcomes. */
  readonly onRollback = (effect: () => void) =>
    listenRedisJournal(this.#draft.terminal.rolledBack, effect)
  /** End effects drain for every native outcome, including ambiguous EXEC. */
  readonly onEnd = (effect: () => void) => listenRedisJournal(this.#draft.terminal.ended, effect)
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
    readonly info: ReturnType<typeof import('@migaia/storage-host/sdk').assertTransactionOwner>
  }
}): IStorageJournalBackendBinding {
  return {
    forOrg: input.forOrg,
    openNamespace: async (prefix): Promise<IStorageJournalNamespace> => {
      input.assertLive()
      if (typeof prefix !== 'string' || prefix.length === 0) throw invalidArgument()
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
          return { info: state.info, port: new RedisJournalTransaction(state.draft, prefix) }
        },
        transaction: (work) =>
          input.run((draft) => work(new RedisJournalTransaction(draft, prefix)))
      })
    },
    changes: (scope): readonly IStorageJournalChange[] => {
      const { draft } = input.state(scope)
      return (draft.journalStages ?? []).map((stage) => ({
        target: stage.target,
        before: stage.before,
        after: stage.after,
        afterRevision: String(BigInt(draft.revisions.get(stage.revisionField) ?? 0) + 1n)
      }))
    }
  }
}
