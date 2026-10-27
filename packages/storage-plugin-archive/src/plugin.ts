import {
  createBackendChangeController,
  withAbort,
  subscribeToAbort,
  throwIfAborted,
  readAbortReason,
  type IBackendChangeController,
  type IStorageOperationReporter,
  compileStorageWhere,
  ConcurrencyPolicy,
  lockKey
} from '@migaia/storage-host/sdk'
import {
  definePlugin,
  type IStorageBackendPluginHandle,
  type IStoragePluginCallContext,
  type IStoragePluginCore,
  type IStorageBorrowedBackend
} from '@migaia/storage-host'
import { createAbortController } from '@migaia/lifecycle'
import {
  blob,
  records,
  ConflictPolicy,
  type IRecordStore,
  type ITransactionBuilder,
  type ITransactionScope,
  type IOperationContext,
  type IBlobApi
} from '@migaia/storage-contract'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { Archive } from './constants.js'
import { ArchiveErrorCode } from './error-code.js'
import {
  archiveError,
  invalidSegment,
  unsupported,
  transactionArchiveError,
  isArchiveError
} from './errors.js'
import { snapshotArchiveOptions, prefixUpper, type IArchiveConfiguration } from './policy.js'
import {
  archivePrefix,
  finishArchiveResource,
  captureRow,
  encodeArchiveRow,
  normalizeValue,
  readSegment,
  segmentStream,
  type IArchiveRow
} from './segment.js'
import {
  controlKey,
  manifestKey,
  directoryKey,
  readManifest,
  readRefs,
  sameManifest,
  changeRefs
} from './metadata.js'
import type {
  IArchiveApi,
  IArchivePluginOptions,
  IArchiveRunOptions,
  IArchiveGetOptions,
  IArchiveRunResult
} from './types.js'
import './hooks.js'

/** Ordinary extensions borrow only these original installation and runtime ports. */
type IArchiveCore = Pick<
  IStoragePluginCore,
  'getPublishedBackend' | 'registerDetect' | 'getOrgContext' | 'createChangeController' | 'emit'
>
/** Borrow admission only needs the genuine finite record protocol, not a fabricated full base. */
type IArchiveHot = Pick<
  IRecordStore<ICollectionsCodecValue>,
  'getRecord' | 'iterateRecords' | 'putRecord' | 'deleteRecord' | 'transaction'
> & { tx(): ITransactionBuilder<ITransactionScope<ICollectionsCodecValue>> }
/** A single operation owns its current segment and committed counts. */
type IArchiveRunBatch = {
  rows: IArchiveRow[]
  bytes: number
  readonly progress: { archived: number; skipped: number; segments: number }
}
/** One explicit run shares cutoff, candidate membership and certainly committed counts across rules. */
type IArchiveRuleExecution = {
  readonly now: number
  readonly seen: Set<string>
  readonly progress: IArchiveRunBatch['progress']
  readonly limit: number | undefined
}
/** Capture the finite run input once, also admitting replacement input from the original pipeline. */
function captureRunInput(configuration: IArchiveConfiguration, input: unknown) {
  if (input !== undefined && (typeof input !== 'object' || input === null || Array.isArray(input)))
    throw archiveError(ArchiveErrorCode.invalidArgument)
  const { rule, limit } = (input ?? {}) as { readonly rule?: unknown; readonly limit?: unknown }
  if (
    (rule !== undefined && typeof rule !== 'string') ||
    (limit !== undefined && (!Number.isSafeInteger(limit) || (limit as number) <= 0))
  )
    throw archiveError(ArchiveErrorCode.invalidArgument)
  const selected =
    rule === undefined
      ? configuration.rules
      : configuration.rules.filter((item) => item.name === rule)
  if (selected.length === 0) throw archiveError(ArchiveErrorCode.invalidArgument)
  return {
    selected,
    request: { rule: rule as string | undefined, limit: limit as number | undefined }
  }
}
/**
 * String keys and explicit restore are captured before native reads, including pipeline
 * replacements.
 */
function captureGetInput(input: unknown) {
  if (typeof input !== 'object' || input === null || Array.isArray(input))
    throw archiveError(ArchiveErrorCode.invalidArgument)
  const { key, restore } = input as { readonly key?: unknown; readonly restore?: unknown }
  if (typeof key !== 'string' || (restore !== undefined && typeof restore !== 'boolean'))
    throw archiveError(ArchiveErrorCode.invalidArgument)
  return { key, restore: restore === true }
}
/** Preserve coded native failures and attach certain committed progress without exposing records. */
function runFailure(cause: unknown, progress: IArchiveRunResult): Error {
  const error = archiveError(ArchiveErrorCode.operationFailed, cause)
  if (Object.isExtensible(error))
    Object.defineProperty(error, 'progress', {
      value: { ...progress },
      enumerable: true
    })
  return error
}
/** Only the token and actual transaction/record functions prove this borrowed hot protocol. */
function admitHot(borrowed: IStorageBorrowedBackend): IArchiveHot {
  if (
    borrowed.backend === 'indexed-db' ||
    !borrowed.has(records) ||
    !borrowed.capabilities.transactions ||
    !borrowed.capabilities.records ||
    !borrowed.capabilities.iteration
  )
    unsupported()
  borrowed.use(records)
  for (const name of [
    'getRecord',
    'iterateRecords',
    'putRecord',
    'deleteRecord',
    'transaction',
    'tx'
  ] as const)
    if (typeof (borrowed as unknown as Record<string, unknown>)[name] !== 'function') unsupported()
  return borrowed as unknown as IArchiveHot
}
/**
 * Install an ordinary contextual extension; all physical storage and locks stay with borrowed
 * owners.
 */
export function archivePlugin<const N extends string, T = ICollectionsCodecValue>(
  options: IArchivePluginOptions<T> & { readonly id: N }
): IStorageBackendPluginHandle<IArchiveApi<N>> & { readonly id: N } {
  const configuration = snapshotArchiveOptions(options),
    id = configuration.id as N
  const descriptor = (core: IArchiveCore) => ({
    install() {
      const borrowedHot = core.getPublishedBackend(configuration.hot),
        borrowedCold = core.getPublishedBackend(configuration.cold)
      admitHot(borrowedHot)
      if (!borrowedCold.has(blob)) unsupported()
      borrowedCold.use(blob)
      core.registerDetect(async () => {
        try {
          new CompressionStream(Archive.compression)
          new DecompressionStream(Archive.compression)
        } catch (cause) {
          unsupported(cause)
        }
      })
      const controller = core.createChangeController(
        { backend: Archive.backend },
        createBackendChangeController
      )
      /** One named archive owns the borrowed backends; each flat function receives its org. */
      const archive = new ArchiveOperations(
        configuration,
        core,
        borrowedHot,
        borrowedCold,
        controller
      )
      return {
        [`${id}${Archive.runSuffix}`](
          this: IStoragePluginCallContext,
          options?: IArchiveRunOptions
        ) {
          return archive.run(this, options)
        },
        [`${id}${Archive.getSuffix}`](
          this: IStoragePluginCallContext,
          key: string,
          options?: IArchiveGetOptions
        ) {
          return archive.get(this, key, options)
        },
        [`${id}${Archive.sweepSuffix}`](this: IStoragePluginCallContext, ctx?: IOperationContext) {
          return archive.sweep(this, ctx)
        }
      } as IArchiveApi<N>
    }
  })
  return definePlugin(id, descriptor) as unknown as IStorageBackendPluginHandle<IArchiveApi<N>> & {
    readonly id: N
  }
}
/** Archive operations share explicit state while the host owns their lifecycle. */
class ArchiveOperations {
  /** Immutable archive rules select the records owned by this plugin. */
  readonly #configuration: IArchiveConfiguration
  /** Host execution and hooks preserve organization routing. */
  readonly #core: IArchiveCore
  /** Borrowed hot storage retains ownership of transactions and records. */
  readonly #borrowedHot: IStorageBorrowedBackend
  /** Borrowed cold storage retains ownership of archive objects. */
  readonly #borrowedCold: IStorageBorrowedBackend
  /** Existing controller drains accepted work before backend disposal. */
  readonly #owner: IBackendChangeController
  /** Plugin identity scopes manifest keys and diagnostic events. */
  readonly #id: string
  /** Stable prefix locates only this plugin's archive objects. */
  readonly #prefix: string

  /** Capture installation ports without opening additional storage or lifecycle owners. */
  constructor(
    configuration: IArchiveConfiguration,
    core: IArchiveCore,
    borrowedHot: IStorageBorrowedBackend,
    borrowedCold: IStorageBorrowedBackend,
    owner: IBackendChangeController
  ) {
    this.#configuration = configuration
    this.#core = core
    this.#borrowedHot = borrowedHot
    this.#borrowedCold = borrowedCold
    this.#owner = owner
    this.#id = configuration.id
    this.#prefix = archivePrefix(configuration.id)
  }
  /** Original hot builder owns lock wait, callback admission, revisions and physical terminal drain. */
  async #transaction<R>(
    hot: IArchiveHot,
    ctx: IOperationContext,
    run: (scope: ITransactionScope<ICollectionsCodecValue>) => Promise<R>
  ): Promise<R> {
    let declared: Error | undefined
    try {
      return await hot
        .tx()
        .lock(lockKey.record(controlKey(this.#id)))
        .concurrency(ConcurrencyPolicy.wait())
        .signal(ctx.signal!)
        .run(async (tx) => {
          try {
            return await run(tx)
          } catch (cause) {
            if (isArchiveError(cause)) declared = cause
            throw cause
          }
        })
    } catch (cause) {
      if (declared !== undefined) throw transactionArchiveError(declared, cause)
      throw cause
    }
  }
  /**
   * Native I/O sees the single merged operation signal, while raw work always drains before
   * cleanup.
   */
  #execute<R>(
    call: IStoragePluginCallContext,
    operation: string,
    input: unknown,
    ctx: IOperationContext | undefined,
    work: (
      hot: IArchiveHot,
      cold: IBlobApi,
      ctx: IOperationContext,
      input: unknown,
      reporter: IStorageOperationReporter
    ) => Promise<R>
  ): Promise<R> {
    this.#owner.assertLive()
    const release = this.#owner.beginMutation()
    try {
      return this.#core
        .getOrgContext(call.orgId)
        .execution.run({ operation, input, ctx }, (captured) =>
          withAbort(ctx, async (signal, snapshot, runtime) => {
            if (snapshot?.orgId !== undefined && snapshot.orgId !== call.orgId)
              throw archiveError(ArchiveErrorCode.invalidArgument)
            const controller = createAbortController(),
              abort = () => controller.abort(readAbortReason(signal)),
              close = () => controller.abort(readAbortReason(this.#owner.closingSignal))
            const unsubscribe = subscribeToAbort(signal, abort, runtime.reporter),
              unclose = subscribeToAbort(this.#owner.closingSignal, close, runtime.reporter)
            try {
              throwIfAborted(controller.signal)
              return await work(
                admitHot(call.backend(this.#borrowedHot)),
                call.backend(this.#borrowedCold).use(blob),
                { signal: controller.signal, pageSize: snapshot?.pageSize, orgId: snapshot?.orgId },
                captured,
                runtime.reporter
              )
            } finally {
              unsubscribe()
              unclose()
            }
          })
        )
        .finally(release)
    } catch (cause) {
      release()
      throw cause
    }
  }
  /** Hook payload identities refer to this extension's actual organization, never a borrowed root. */
  #identity(call: IStoragePluginCallContext) {
    return { backendId: this.#id, backend: Archive.backend, orgId: call.orgId }
  }
  /** Archive matching hot records for the invoking organization. */
  run(callContext: IStoragePluginCallContext, options?: IArchiveRunOptions) {
    let captured: ReturnType<typeof captureRunInput>
    try {
      captured = captureRunInput(this.#configuration, options)
    } catch (cause) {
      // Finite argument failures reject; unsupported accessors are not normalized here.
      if (isArchiveError(cause)) return Promise.reject(cause)
      throw cause
    }
    // The host already owns this immutable org identity and genuine backend projection.
    const call = callContext
    const progress = { archived: 0, skipped: 0, segments: 0 }
    return this.#execute(call, Archive.run, captured.request, options, (hot, cold, ctx, input) =>
      this.#runRules(call, hot, cold, ctx, input, progress)
    )
  }

  /** Compile each selected ordered rule once, publish only committed counts and preserve errors. */
  async #runRules(
    call: IStoragePluginCallContext,
    hot: IArchiveHot,
    cold: IBlobApi,
    ctx: IOperationContext,
    input: unknown,
    progress: IArchiveRunBatch['progress']
  ): Promise<IArchiveRunResult> {
    // The original pipeline may rewrite scalar request fields in place before this native job.
    const {
      selected,
      request: { limit }
    } = captureRunInput(this.#configuration, input)
    this.#core.emit(Archive.beforeRun, () => ({
      ...this.#identity(call),
      ruleCount: selected.length,
      ...(limit === undefined ? {} : { limit })
    }))
    try {
      const now = Date.now(),
        seen = new Set<string>()
      for (const rule of selected) {
        await this.#runRule(hot, cold, ctx, rule, { now, seen, progress, limit })
        if (limit !== undefined && seen.size >= limit) break
      }
      this.#core.emit(Archive.afterRun, () => ({ ...this.#identity(call), ...progress }))
      return { ...progress }
    } catch (cause) {
      const error = runFailure(cause, progress)
      this.#core.emit(Archive.runError, () => ({
        ...this.#identity(call),
        ...progress,
        code: (error as Error & { code?: string }).code
      }))
      throw error
    }
  }
  /** The original iterator and cold/hot terminals own one rule's bounded native work. */
  async #runRule(
    hot: IArchiveHot,
    cold: IBlobApi,
    ctx: IOperationContext,
    rule: IArchiveConfiguration['rules'][number],
    state: IArchiveRuleExecution
  ): Promise<void> {
    const predicate = compileStorageWhere<ICollectionsCodecValue>(
        rule.where(state.now - rule.olderThanMs)
      ),
      upper = prefixUpper(rule.prefix)
    const iterator = hot.iterateRecords(
      { lower: rule.prefix, ...(upper === undefined ? {} : { upper, upperOpen: true }) },
      ctx
    )
    /** Per-rule segment state stays explicit across uploads and native commits. */
    const batch: IArchiveRunBatch = { rows: [], bytes: 0, progress: state.progress }
    /** Cleanup retains the first work failure if iterator disposal also fails. */
    let primary: unknown,
      failed = false
    try {
      for await (const [key, value] of iterator) {
        throwIfAborted(ctx.signal)
        if (typeof key !== 'string' || !key.startsWith(rule.prefix)) break
        if (state.seen.has(key) || !predicate(value)) continue
        if (state.limit !== undefined && state.seen.size >= state.limit) break
        const row = captureRow(key, value)
        if (batch.rows.length > 0 && batch.bytes + row.bytes.byteLength > rule.segmentBytes)
          await this.#flushSegment(hot, cold, ctx, rule, predicate, batch)
        state.seen.add(key)
        batch.rows.push(row)
        batch.bytes += row.bytes.byteLength
        if (batch.bytes >= rule.segmentBytes)
          await this.#flushSegment(hot, cold, ctx, rule, predicate, batch)
        if (state.limit !== undefined && state.seen.size >= state.limit) break
      }
      await this.#flushSegment(hot, cold, ctx, rule, predicate, batch)
    } catch (cause) {
      failed = true
      primary = cause
      throw cause
    } finally {
      await finishArchiveResource(() => iterator.dispose(), failed, primary)
    }
  }
  /** Upload one segment, commit unchanged rows once, then advance this operation's batch. */
  async #flushSegment(
    hot: IArchiveHot,
    cold: IBlobApi,
    ctx: IOperationContext,
    rule: IArchiveConfiguration['rules'][number],
    predicate: (value: ICollectionsCodecValue) => boolean,
    batch: IArchiveRunBatch
  ): Promise<void> {
    if (batch.rows.length === 0) return
    throwIfAborted(ctx.signal)
    /** A fresh object belongs to this batch until its hot manifest commit succeeds. */
    const segmentId = crypto.randomUUID(),
      rows = batch.rows,
      objectKey = this.#prefix + segmentId
    /** Cold upload completion precedes the single original hot transaction. */
    const info = await cold.put(objectKey, segmentStream(rows), {
      ifNoneMatch: true,
      contentType: Archive.contentType,
      metadata: {
        format: Archive.format,
        version: String(Archive.version),
        compression: Archive.compression
      },
      ctx
    })
    /** Only unchanged rows create references and contribute to committed counts. */
    const result = await this.#transaction(hot, ctx, async (tx) => {
      /** The manifest may only reference the uploaded immutable object checked under this lock. */
      const head = await cold.head(objectKey, ctx)
      if (head === undefined || head.etag !== info.etag)
        throw archiveError(ArchiveErrorCode.operationFailed)
      /** Count only rows this transaction actually archives or excludes after rechecking. */
      let archived = 0,
        skipped = 0
      for (let line = 0; line < rows.length; line++) {
        /** Compare the original candidate against the current record before moving it. */
        const row = rows[line]!,
          current = await tx.getRecord(row.key)
        if (
          current === undefined ||
          encodeArchiveRow(row.key, current) !== row.encoded ||
          !predicate(current)
        ) {
          skipped++
          continue
        }
        /** Replacing an earlier manifest transfers its segment reference in this transaction. */
        const old = readManifest(await tx.getRecord(manifestKey(this.#id, row.key)))
        if (old) await changeRefs(tx, this.#id, old.segmentId, -1)
        await tx.putRecord(
          { version: Archive.version, state: { segmentId, line, rule: rule.name } },
          manifestKey(this.#id, row.key)
        )
        await changeRefs(tx, this.#id, segmentId, 1)
        await tx.deleteRecord(row.key)
        archived++
      }
      return { archived, skipped, segments: archived > 0 ? 1 : 0 }
    })
    batch.progress.archived += result.archived
    batch.progress.skipped += result.skipped
    batch.progress.segments += result.segments
    batch.rows = []
    batch.bytes = 0
  }
  /** Read or explicitly restore one archived record for the invoking organization. */
  get(callContext: IStoragePluginCallContext, key: string, options?: IArchiveGetOptions) {
    let captured: ReturnType<typeof captureGetInput>
    try {
      captured = captureGetInput({ key, restore: options?.restore })
    } catch (cause) {
      if (isArchiveError(cause)) return Promise.reject(cause)
      throw cause
    }
    // The host already owns this immutable org identity and genuine backend projection.
    const call = callContext
    return this.#execute(call, Archive.get, captured, options, (hot, cold, ctx, input, reporter) =>
      this.#readRecord(call, hot, cold, ctx, input, reporter)
    )
  }
  /** Resolve a hot record or immutable manifest under the original finite restore race protocol. */
  async #readRecord(
    call: IStoragePluginCallContext,
    hot: IArchiveHot,
    cold: IBlobApi,
    ctx: IOperationContext,
    input: unknown,
    reporter: IStorageOperationReporter
  ): Promise<ICollectionsCodecValue | undefined> {
    // Revalidate the admitted pipeline output rather than relying on mutable request identity.
    const { key, restore } = captureGetInput(input)
    try {
      const current = await hot.getRecord(key, ctx)
      if (current !== undefined) {
        if (restore)
          this.#core.emit(Archive.afterRestore, () => ({
            ...this.#identity(call),
            restored: false
          }))
        return normalizeValue(current)
      }
      const manifest = readManifest(await hot.getRecord(manifestKey(this.#id, key), ctx))
      let value: ICollectionsCodecValue | undefined,
        segmentFailure: unknown,
        segmentFailed = false
      if (manifest) {
        try {
          const object = await cold.get(this.#prefix + manifest.segmentId, { ctx })
          if (!object) throw invalidSegment()
          value = await readSegment(object, key, manifest.line, ctx, reporter)
        } catch (cause) {
          segmentFailure = cause
          segmentFailed = true
        }
      }
      const result = await this.#transaction(hot, ctx, async (tx) => {
        const latest = await tx.getRecord(key)
        if (latest !== undefined) return { value: normalizeValue(latest), restored: false }
        const next = readManifest(await tx.getRecord(manifestKey(this.#id, key)))
        if (next === undefined) return { value: undefined, restored: false }
        if (manifest === undefined || !sameManifest(next, manifest))
          throw archiveError(ArchiveErrorCode.operationFailed)
        if (segmentFailed) throw segmentFailure
        if (restore) {
          await tx.putRecord(value!, key, { conflictPolicy: ConflictPolicy.replace })
          await tx.deleteRecord(manifestKey(this.#id, key))
          await changeRefs(tx, this.#id, manifest.segmentId, -1)
        }
        return { value, restored: restore }
      })
      if (restore)
        this.#core.emit(Archive.afterRestore, () => ({
          ...this.#identity(call),
          restored: result.restored
        }))
      return result.value
    } catch (cause) {
      throw archiveError(ArchiveErrorCode.operationFailed, cause)
    }
  }
  /** Remove unreferenced archive segments for the invoking organization. */
  sweep(callContext: IStoragePluginCallContext, context?: IOperationContext) {
    // The host already owns this immutable org identity and genuine backend projection.
    const call = callContext
    return this.#execute(call, Archive.sweep, undefined, context, (hot, cold, ctx) =>
      this.#sweepSegments(call, hot, cold, ctx)
    )
  }
  /** Native opaque pages and the original control transaction define each actual removal. */
  async #sweepSegments(
    call: IStoragePluginCallContext,
    hot: IArchiveHot,
    cold: IBlobApi,
    ctx: IOperationContext
  ): Promise<import('./types.js').IArchiveSweepResult> {
    let after: string | undefined,
      scanned = 0,
      removed = 0
    try {
      do {
        throwIfAborted(ctx.signal)
        const page = await cold.list({ prefix: this.#prefix, after, limit: Archive.pageSize }, ctx)
        for (const info of page.items) {
          scanned++
          if (
            !info.key.startsWith(this.#prefix) ||
            info.metadata.format !== Archive.format ||
            info.metadata.version !== String(Archive.version)
          )
            continue
          const segmentId = info.key.slice(this.#prefix.length)
          if (
            await this.#transaction(hot, ctx, async (tx) =>
              readRefs(await tx.getRecord(directoryKey(this.#id, segmentId))) > 0
                ? false
                : cold.remove(info.key, ctx)
            )
          )
            removed++
        }
        after = page.next
      } while (after !== undefined)
      const result = { scanned, removed }
      this.#core.emit(Archive.afterSweep, () => ({ ...this.#identity(call), ...result }))
      return result
    } catch (cause) {
      throw archiveError(ArchiveErrorCode.operationFailed, cause)
    }
  }
}
