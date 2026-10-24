import {
  definePlugin,
  type IStorageBackendPluginHandle,
  type IStoragePluginCallContext,
  type IStoragePluginCore,
  type IStorageBorrowedBackend
} from '@migaia/storage-host'
import { createAbortController } from '@migaia/lifecycle'
import {
  withAbort,
  subscribeToAbort,
  throwIfAborted,
  readAbortReason,
  type IBackendChangeController,
  type IStorageOperationReporter
} from '@migaia/storage-host/authoring/backend'
import {
  blob,
  records,
  compileStorageWhere,
  ConcurrencyPolicy,
  ConflictPolicy,
  lockKey,
  type IRecordStore,
  type ITransactionBuilder,
  type ITransactionScope,
  type IOperationContext,
  type IBlobApi
} from '@migaia/storage-contract'
import type { ICollectionsCodecValue } from '@migaia/serialize/codecs/collections-json'
import { Archive } from './constants.js'
import { tryReadProperty } from '@migaia/utils/error'
import { ArchiveErrorCode, ERROR_SOURCE } from './error-code.js'
import { archiveError, invalidSegment, unsupported, transactionArchiveError } from './errors.js'
import { snapshotArchiveOptions, prefixUpper, type IArchiveConfiguration } from './policy.js'
import {
  archivePrefix,
  finishArchiveResource,
  captureRow,
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
    request: Object.freeze({ rule: rule as string | undefined, limit: limit as number | undefined })
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
  return Object.freeze({ key, restore: restore === true })
}
/** Preserve coded native failures and attach certain committed progress without exposing records. */
function runFailure(cause: unknown, progress: IArchiveRunResult): Error {
  const error = archiveError(ArchiveErrorCode.operationFailed, cause)
  if (Object.isExtensible(error))
    Object.defineProperty(error, 'progress', {
      value: Object.freeze({ ...progress }),
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
    if (typeof Reflect.get(borrowed, name) !== 'function') unsupported()
  return borrowed as unknown as IArchiveHot
}
/**
 * Install an ordinary contextual extension; all physical storage and locks stay with borrowed
 * owners.
 */
export function archivePlugin<const N extends string, T = ICollectionsCodecValue>(
  options: IArchivePluginOptions<T> & { readonly id: N }
): IStorageBackendPluginHandle<Readonly<Record<N, IArchiveApi>>> & { readonly id: N } {
  const configuration = snapshotArchiveOptions(options),
    id = configuration.id as N
  const descriptor = (core: IArchiveCore) => ({
    contextualExtensions: [id],
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
      const controller = core.createChangeController({ backend: Archive.backend })
      return {
        [id]: createArchiveApi(configuration, core, borrowedHot, borrowedCold, controller)
      } as Readonly<Record<N, IArchiveApi>>
    }
  })
  return definePlugin(id, descriptor) as unknown as IStorageBackendPluginHandle<
    Readonly<Record<N, IArchiveApi>>
  > & { readonly id: N }
}
/** One outer pipeline and original cancellation budget own each explicit operation's actual work. */
function createArchiveApi(
  configuration: IArchiveConfiguration,
  core: IArchiveCore,
  borrowedHot: IStorageBorrowedBackend,
  borrowedCold: IStorageBorrowedBackend,
  owner: IBackendChangeController
): IArchiveApi {
  const id = configuration.id,
    prefix = archivePrefix(id)
  /** Original hot builder owns lock wait, callback admission, revisions and physical terminal drain. */
  const transaction = async <R>(
    hot: IArchiveHot,
    ctx: IOperationContext,
    run: (scope: ITransactionScope<ICollectionsCodecValue>) => Promise<R>
  ): Promise<R> => {
    let declared: Error | undefined
    try {
      return await hot
        .tx()
        .lock(lockKey.record(controlKey(id)))
        .concurrency(ConcurrencyPolicy.wait())
        .signal(ctx.signal!)
        .run(async (tx) => {
          try {
            return await run(tx)
          } catch (cause) {
            if (cause instanceof Error) {
              const source = tryReadProperty(cause as { source?: unknown }, 'source')
              if (!source.threw && source.value === ERROR_SOURCE) declared = cause
            }
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
  const execute = <R>(
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
  ): Promise<R> => {
    owner.assertLive()
    const release = owner.beginMutation()
    try {
      return core
        .getOrgContext(call.orgId)
        .execution.run({ operation, input, ctx }, (captured) =>
          withAbort(ctx, async (signal, snapshot, runtime) => {
            if (snapshot?.orgId !== undefined && snapshot.orgId !== call.orgId)
              throw archiveError(ArchiveErrorCode.invalidArgument)
            const controller = createAbortController(),
              abort = () => controller.abort(readAbortReason(signal)),
              close = () => controller.abort(readAbortReason(owner.closingSignal))
            const unsubscribe = subscribeToAbort(signal, abort, runtime.reporter),
              unclose = subscribeToAbort(owner.closingSignal, close, runtime.reporter)
            try {
              throwIfAborted(controller.signal)
              return await work(
                admitHot(call.backend(borrowedHot)),
                call.backend(borrowedCold).use(blob),
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
  const identity = (call: IStoragePluginCallContext) => ({
    backendId: id,
    backend: Archive.backend,
    orgId: call.orgId
  })
  return {
    run(this: IStoragePluginCallContext, options?: IArchiveRunOptions) {
      let captured: ReturnType<typeof captureRunInput>
      try {
        captured = captureRunInput(configuration, options)
      } catch (cause) {
        return Promise.reject(archiveError(ArchiveErrorCode.invalidArgument, cause))
      }
      const call = {
          orgId: this.orgId,
          backend: <S extends IStorageBorrowedBackend>(borrowed: S): S => this.backend(borrowed)
        },
        progress = { archived: 0, skipped: 0, segments: 0 }
      return execute(
        call,
        Archive.run,
        captured.request,
        options,
        async (hot, cold, ctx, input) => {
          const {
            selected,
            request: { limit }
          } = input === captured.request ? captured : captureRunInput(configuration, input)
          core.emit(Archive.beforeRun, () => ({
            ...identity(call),
            ruleCount: selected.length,
            ...(limit === undefined ? {} : { limit })
          }))
          try {
            const now = Date.now(),
              seen = new Set<string>()
            for (const rule of selected) {
              const predicate = compileStorageWhere<ICollectionsCodecValue>(
                  rule.where(now - rule.olderThanMs)
                ),
                upper = prefixUpper(rule.prefix)
              const iterator = hot.iterateRecords(
                { lower: rule.prefix, ...(upper === undefined ? {} : { upper, upperOpen: true }) },
                ctx
              )
              let rows: IArchiveRow[] = [],
                bytes = 0,
                primary: unknown,
                failed = false
              /** A completed upload is followed by exactly one original hot control transaction. */
              const flush = async () => {
                if (rows.length === 0) return
                throwIfAborted(ctx.signal)
                const segmentId = crypto.randomUUID(),
                  batch = rows,
                  objectKey = prefix + segmentId
                const info = await cold.put(objectKey, segmentStream(batch), {
                  ifNoneMatch: true,
                  contentType: Archive.contentType,
                  metadata: {
                    format: Archive.format,
                    version: String(Archive.version),
                    compression: Archive.compression
                  },
                  ctx
                })
                const result = await transaction(hot, ctx, async (tx) => {
                  const head = await cold.head(objectKey, ctx)
                  if (head === undefined || head.etag !== info.etag)
                    throw archiveError(ArchiveErrorCode.operationFailed)
                  let archived = 0,
                    skipped = 0
                  for (let line = 0; line < batch.length; line++) {
                    const row = batch[line]!,
                      current = await tx.getRecord(row.key)
                    if (
                      current === undefined ||
                      captureRow(row.key, current).encoded !== row.encoded ||
                      !predicate(current)
                    ) {
                      skipped++
                      continue
                    }
                    const old = readManifest(await tx.getRecord(manifestKey(id, row.key)))
                    if (old) await changeRefs(tx, id, old.segmentId, -1)
                    await tx.putRecord(
                      { version: Archive.version, state: { segmentId, line, rule: rule.name } },
                      manifestKey(id, row.key)
                    )
                    await changeRefs(tx, id, segmentId, 1)
                    await tx.deleteRecord(row.key)
                    archived++
                  }
                  return { archived, skipped, segments: archived > 0 ? 1 : 0 }
                })
                progress.archived += result.archived
                progress.skipped += result.skipped
                progress.segments += result.segments
                rows = []
                bytes = 0
              }
              try {
                for await (const [key, value] of iterator) {
                  throwIfAborted(ctx.signal)
                  if (typeof key !== 'string' || !key.startsWith(rule.prefix)) break
                  if (seen.has(key) || !predicate(value)) continue
                  if (limit !== undefined && seen.size >= limit) break
                  const row = captureRow(key, value)
                  if (rows.length > 0 && bytes + row.bytes.byteLength > rule.segmentBytes)
                    await flush()
                  seen.add(key)
                  rows.push(row)
                  bytes += row.bytes.byteLength
                  if (bytes >= rule.segmentBytes) await flush()
                  if (limit !== undefined && seen.size >= limit) break
                }
                await flush()
              } catch (cause) {
                failed = true
                primary = cause
                throw cause
              } finally {
                await finishArchiveResource(() => iterator.dispose(), failed, primary)
              }
              if (limit !== undefined && seen.size >= limit) break
            }
            core.emit(Archive.afterRun, () => ({ ...identity(call), ...progress }))
            return { ...progress }
          } catch (cause) {
            const error = runFailure(cause, progress)
            core.emit(Archive.runError, () => ({
              ...identity(call),
              ...progress,
              code: Reflect.get(error, 'code') as string | undefined
            }))
            throw error
          }
        }
      )
    },
    get(this: IStoragePluginCallContext, key: string, options?: IArchiveGetOptions) {
      let captured: ReturnType<typeof captureGetInput>
      try {
        captured = captureGetInput({ key, restore: options?.restore })
      } catch (cause) {
        return Promise.reject(archiveError(ArchiveErrorCode.invalidArgument, cause))
      }
      const call = {
        orgId: this.orgId,
        backend: <S extends IStorageBorrowedBackend>(borrowed: S): S => this.backend(borrowed)
      }
      return execute(
        call,
        Archive.get,
        captured,
        options,
        async (hot, cold, ctx, input, reporter) => {
          const { key, restore } = input === captured ? captured : captureGetInput(input)
          try {
            const current = await hot.getRecord(key, ctx)
            if (current !== undefined) {
              if (restore)
                core.emit(Archive.afterRestore, () => ({ ...identity(call), restored: false }))
              return normalizeValue(current)
            }
            const manifest = readManifest(await hot.getRecord(manifestKey(id, key), ctx))
            let value: ICollectionsCodecValue | undefined,
              segmentFailure: unknown,
              segmentFailed = false
            if (manifest) {
              try {
                const object = await cold.get(prefix + manifest.segmentId, { ctx })
                if (!object) throw invalidSegment()
                value = await readSegment(object, key, manifest.line, ctx, reporter)
              } catch (cause) {
                segmentFailure = cause
                segmentFailed = true
              }
            }
            const result = await transaction(hot, ctx, async (tx) => {
              const latest = await tx.getRecord(key)
              if (latest !== undefined) return { value: normalizeValue(latest), restored: false }
              const next = readManifest(await tx.getRecord(manifestKey(id, key)))
              if (next === undefined) return { value: undefined, restored: false }
              if (manifest === undefined || !sameManifest(next, manifest))
                throw archiveError(ArchiveErrorCode.operationFailed)
              if (segmentFailed) throw segmentFailure
              if (restore) {
                await tx.putRecord(value!, key, { conflictPolicy: ConflictPolicy.replace })
                await tx.deleteRecord(manifestKey(id, key))
                await changeRefs(tx, id, manifest.segmentId, -1)
              }
              return { value, restored: restore }
            })
            if (restore)
              core.emit(Archive.afterRestore, () => ({
                ...identity(call),
                restored: result.restored
              }))
            return result.value
          } catch (cause) {
            throw archiveError(ArchiveErrorCode.operationFailed, cause)
          }
        }
      )
    },
    sweep(this: IStoragePluginCallContext, context?: IOperationContext) {
      const call = {
        orgId: this.orgId,
        backend: <S extends IStorageBorrowedBackend>(borrowed: S): S => this.backend(borrowed)
      }
      return execute(call, Archive.sweep, undefined, context, async (hot, cold, ctx) => {
        let after: string | undefined,
          scanned = 0,
          removed = 0
        try {
          do {
            throwIfAborted(ctx.signal)
            const page = await cold.list({ prefix, after, limit: Archive.pageSize }, ctx)
            for (const info of page.items) {
              scanned++
              if (
                !info.key.startsWith(prefix) ||
                info.metadata.format !== Archive.format ||
                info.metadata.version !== String(Archive.version)
              )
                continue
              const segmentId = info.key.slice(prefix.length)
              if (
                await transaction(hot, ctx, async (tx) =>
                  readRefs(await tx.getRecord(directoryKey(id, segmentId))) > 0
                    ? false
                    : cold.remove(info.key, ctx)
                )
              )
                removed++
            }
            after = page.next
          } while (after !== undefined)
          const result = { scanned, removed }
          core.emit(Archive.afterSweep, () => ({ ...identity(call), ...result }))
          return result
        } catch (cause) {
          throw archiveError(ArchiveErrorCode.operationFailed, cause)
        }
      })
    }
  }
}
