import { createLifecycleScope, createAbortController } from '@migaia/lifecycle'
import {
  blob,
  implement,
  provideCapabilities,
  createTransactionOwner,
  runWithConcurrency,
  lockKey,
  encodeOrderedStorageKey,
  decodeOrderedStorageKey,
  prefixStorageOrgKey,
  unprefixStorageOrgKey,
  encodeStorageOrgStringPrefix,
  snapshotStorageBlobPut,
  snapshotStorageBlobGet,
  snapshotStorageBlobList,
  createStorageBlobObject,
  assertStringStorageKey,
  assertOperationContext,
  snapshotOperationContext,
  type IBlobApi,
  type ICapabilityInstallPort,
  type IOperationContext,
  type IStorageBase,
  type IStorageStore,
  type ITransactionOptions
} from '@migaia/storage-contract'
import type { IStoragePluginCore } from '@migaia/storage-host'
import {
  observeStorageBatch,
  subscribeToAbort,
  readAbortReason,
  throwIfAborted
} from '@migaia/storage-host/authoring/backend'
import { systemScheduler } from '@migaia/utils/scheduler'
import { bytesToBase64, base64ToBytes } from '@migaia/utils/bytes'
import { readObjectDriver } from './driver.js'
import { ObjectNames } from './constants.js'
import { invalidArgument, normalizeObjectError } from './errors.js'
import { ObjectErrorText } from './error-text.js'
import { ObjectErrorCode } from './error-code.js'
import { objectError } from './errors.js'
import { encodeObjectWireBytes as hex, decodeObjectWireBytes as unhex } from './wire.js'
import type { IObjectDriver, IObjectNative, IObjectStore } from './types.js'

/** Native Features reuse the exact original store observer without adding public store methods. */
const featureObservation = Symbol('object-feature-observation')
/** Internal callback carries no native client, installation or shutdown authority. */
type IObjectFeatureObserver = <T>(
  operation: string,
  ctx: IOperationContext | undefined,
  invoke: () => Promise<T>
) => Promise<T>
/** A Feature already runs inside the host pipeline and borrows only this native observation path. */
export function observeObjectFeature<T>(
  store: IObjectStore,
  operation: string,
  ctx: IOperationContext | undefined,
  invoke: () => Promise<T>
): Promise<T> {
  return (store as IObjectStore & { [featureObservation]: IObjectFeatureObserver })[
    featureObservation
  ](operation, ctx, invoke)
}
/** Build one named backend and publish it only after the native driver has opened. */
export async function createObjectBackend(driver: IObjectDriver, core: IStoragePluginCore) {
  /** Construction retains original lifecycle owners; failure drains them before rejection. */
  const backend = new ObjectBackend(core)
  await backend.open(driver)
  return backend
}

/** Physical object storage owns one driver, lock port and set of organization views. */
class ObjectBackend {
  /** Host ports supply execution and reporting without a second storage host. */
  readonly #core: IStoragePluginCore
  /** Original lifecycle releases content and locks before the native driver. */
  readonly #resources: ReturnType<typeof createLifecycleScope>
  /** Open blob resources drain before native storage closes. */
  readonly reads: ReturnType<typeof createLifecycleScope>
  /** The canonical host key-lock port owns local contention. */
  readonly #locks: ReturnType<IStoragePluginCore['createKeyLockPort']>
  /** Fixed organization views share the physical driver and never own its shutdown. */
  readonly #stores = new Map<string, ObjectOrganization>()
  /** Opaque list cursors are valid only for this installed backend. */
  readonly identity: string
  /** Opened native storage is assigned before this backend is returned. */
  #native!: IObjectNative
  /** Default organization preserves the construction's original public store slot. */
  readonly #root: ObjectOrganization
  /** Symbol cleanup reports once while ordinary disposal preserves its shared promise. */
  #symbolic: Promise<void> | undefined
  /** The original controller seals admission and drains accepted work. */
  readonly controller: ReturnType<IStoragePluginCore['createChangeController']>

  /** Allocate existing owners in their original order without opening a native driver. */
  constructor(core: IStoragePluginCore) {
    this.#core = core
    this.#resources = createLifecycleScope()
    this.reads = createLifecycleScope()
    this.#locks = core.createKeyLockPort()
    this.identity = crypto.randomUUID()
    this.controller = core.createChangeController({
      backend: ObjectNames.backend,
      finalize: () => this.#finalize()
    })
    this.#root = this.#forOrg(core.defaultOrgId)
  }
  /** Return the admitted default-org store without granting driver ownership. */
  get store() {
    return this.#root.store
  }
  /** Return the capability installation port captured by the default view. */
  get installer() {
    return this.#root.installer
  }
  /** Borrow the already-open physical driver for native Features. */
  get native() {
    return this.#native
  }
  /** Supply immutable organization execution and observation ports to a view. */
  ports(orgId: string) {
    return this.#core.getOrgContext(orgId)
  }
  /** Report native cleanup through the existing host diagnostic boundary. */
  report = (error: unknown): void => {
    this.#core.stageBindings.backendStages.report(error)
  }
  /** Keep symbol cleanup's existing one-report promise separate from ordinary disposal. */
  disposeSymbolic = () =>
    (this.#symbolic ??= this.controller.dispose().then(undefined, this.report))
  /** Dispose existing resources and clear only this physical backend's views. */
  async #finalize() {
    try {
      await this.#resources.dispose()
    } catch (error) {
      throw normalizeObjectError(error)
    } finally {
      this.#stores.clear()
    }
  }
  /** Reuse one fixed organization view; no physical resources are opened here. */
  #forOrg(orgId: string): ObjectOrganization {
    this.controller.assertLive()
    /** Reuse the view whose store identity already belongs to this organization. */
    const existing = this.#stores.get(orgId)
    if (existing) return existing
    /** Only a new organization allocates capability ports. */
    const view = new ObjectOrganization(this, orgId)
    this.#stores.set(orgId, view)
    return view
  }
  /** Borrowed organization views route data while retaining original backend disposal ownership. */
  get orgBinding() {
    return {
      backend: (orgId: string) => this.#forOrg(orgId).store,
      drop: async (orgId: string) => {
        await this.#forOrg(orgId).store.use(blob).removeByPrefix('')
      }
    }
  }
  /** Native drivers reuse the existing concurrency runner and host lock port. */
  #lock = <T>(
    key: string,
    ctx: IOperationContext | undefined,
    run: () => Promise<T>
  ): Promise<T> => {
    /** The existing organization view supplies the same concurrency stage identity. */
    const physical = this.#forOrg(ctx?.orgId ?? this.#core.defaultOrgId)
    return runWithConcurrency(
      {
        store: physical.store,
        options: (ctx ?? {}) as ITransactionOptions,
        lock: () => [lockKey.bytes(key)]
      },
      {
        attempt: (attempt) =>
          this.#locks.attempt(
            attempt,
            { status: 'held', owner: this.identity, scope: 'local', since: Date.now() },
            { attempt: async () => ({ status: 'committed', value: await run() }) },
            this.#core
              .getOrgContext(ctx?.orgId ?? this.#core.defaultOrgId)
              .stageBindings.concurrencyStages(physical.store as IStorageStore<never>),
            this.controller.closingSignal
          )
      }
    )
  }
  /** Open the native driver once and register original resource release order. */
  async open(driver: IObjectDriver): Promise<void> {
    try {
      this.#native = await readObjectDriver(driver)({ report: this.report, lock: this.#lock })
      this.#resources.own(this.#native, { force: () => this.#native.dispose() })
      this.#resources.own(this.#locks, { force: () => this.#locks.dispose() })
      this.#resources.own(this.reads, {
        force: async () => {
          await this.reads.dispose()
        }
      })
    } catch (error) {
      for (const cleanup of await Promise.allSettled([
        this.#locks.dispose(),
        this.reads.dispose(),
        this.controller.dispose()
      ]))
        if (cleanup.status === 'rejected') this.report(cleanup.reason)
      throw normalizeObjectError(error)
    }
  }
  /** Resolve the same organization envelope for native address Features. */
  address = (key: string, ctx?: IOperationContext) => {
    this.controller.assertLive()
    assertStringStorageKey(key, ObjectNames.backend)
    assertOperationContext(ctx)
    return this.#native.address(
      hex(
        encodeOrderedStorageKey(
          prefixStorageOrgKey(ctx?.orgId ?? this.#core.defaultOrgId, key),
          ObjectNames.backend
        )
      )
    )
  }
}

/** One organization view owns its capability methods and immutable routing identity. */
class ObjectOrganization {
  /** Physical storage and lifecycle remain with this original backend. */
  readonly #backend: ObjectBackend
  /** Every logical key is encoded for this immutable organization. */
  readonly #orgId: string
  /** The original host supplies operation execution and stage observation. */
  readonly #ports: ReturnType<IStoragePluginCore['getOrgContext']>
  /** Capability admission uses one original store identity for this view. */
  readonly #base: IStorageBase & { readonly backend: 'object' }
  /** The capability installer is captured during the same original publication. */
  #installer!: ICapabilityInstallPort
  /** The public capability store is assigned before the view is cached. */
  #store!: IObjectStore

  /** Bind one view without creating another driver, controller or lock table. */
  constructor(backend: ObjectBackend, orgId: string) {
    this.#backend = backend
    this.#orgId = orgId
    this.#ports = backend.ports(orgId)
    this.#base = {
      backend: ObjectNames.backend,
      capabilities: {
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      },
      dispose: () => backend.controller.dispose(),
      [Symbol.asyncDispose]: backend.disposeSymbolic
    }
    createTransactionOwner(this.#base, (error) => normalizeObjectError(error) as never, {
      concurrencyStages: this.#ports.stageBindings.concurrencyStages(
        this.#base as IStorageStore<never>
      )
    })
    Object.defineProperty(this.#base, featureObservation, { value: this.#observeFeature })
    /** Bound own-function ports preserve the public capability object shape. */
    const api: IBlobApi = {
      put: this.put,
      get: this.get,
      head: this.head,
      remove: this.remove,
      list: this.list,
      removeByPrefix: this.removeByPrefix
    }
    this.#store = provideCapabilities(this.#base, [implement(blob, api)] as const, {
      onInstaller: (port) => {
        this.#installer = port
      }
    })
  }
  /** Return this view's admitted public capability store. */
  get store() {
    return this.#store
  }
  /** Return the same capability installer captured during construction. */
  get installer() {
    return this.#installer
  }
  /** Native Features already own a host pipeline and borrow only this observation path. */
  #observeFeature: IObjectFeatureObserver = <T>(
    operation: string,
    ctx: IOperationContext | undefined,
    invoke: () => Promise<T>
  ) =>
    this.#admitted(ctx, (context) =>
      observeStorageBatch(
        this.#ports.stageBindings.operationStages(this.#store as IStorageStore<never>),
        systemScheduler,
        operation,
        1,
        async () => {
          throwIfAborted(context.signal)
          return invoke()
        }
      )
    )
  /** Logical strings receive exactly one canonical organization envelope. */
  #wire = (key: string): string => {
    assertStringStorageKey(key, ObjectNames.backend)
    return hex(encodeOrderedStorageKey(prefixStorageOrgKey(this.#orgId, key), ObjectNames.backend))
  }

  /** Returned physical keys are checked and unwrapped by the same organization owner. */
  #logical = (key: string): string => {
    try {
      const result = unprefixStorageOrgKey(
        this.#orgId,
        decodeOrderedStorageKey(unhex(key), ObjectNames.backend)
      )
      if (typeof result !== 'string') throw invalidArgument()
      return result
    } catch (error) {
      throw objectError(ObjectErrorCode.dataInvalid, error)
    }
  }

  /** Resource admission shares one original controller lease until the native operation settles. */
  #admitted = <T>(
    ctx: IOperationContext | undefined,
    invoke: (context: IOperationContext) => Promise<T>
  ): Promise<T> => {
    this.#backend.controller.assertLive()
    /**
     * Context is retained across deferred lock admission; caller mutation must not retarget
     * accepted work.
     */
    const context = snapshotOperationContext(ctx)
    const release = this.#backend.controller.beginMutation()
    const cancellation = createAbortController()
    const unsubscribe: (() => void)[] = []
    try {
      unsubscribe.push(
        subscribeToAbort(
          context?.signal,
          () => cancellation.abort(readAbortReason(context?.signal)),
          this.#backend.report
        )
      )
      unsubscribe.push(
        subscribeToAbort(
          this.#backend.controller.closingSignal,
          () => cancellation.abort(readAbortReason(this.#backend.controller.closingSignal)),
          this.#backend.report
        )
      )
    } catch (error) {
      for (const stop of unsubscribe) stop()
      release()
      throw error
    }
    return Promise.resolve()
      .then(() => invoke({ ...context, signal: cancellation.signal, orgId: this.#orgId }))
      .finally(() => {
        for (const stop of unsubscribe) stop()
        release()
      })
  }

  /** Observe one public operation and invoke the existing host pipeline exactly once. */
  #run = <I, T>(
    operation: string,
    input: I,
    ctx: IOperationContext | undefined,
    invoke: (input: I, ctx: IOperationContext) => Promise<T>
  ): Promise<T> =>
    this.#admitted(ctx, (context) => {
      let captured = input
      return observeStorageBatch(
        this.#ports.stageBindings.operationStages(this.#store as IStorageStore<never>),
        systemScheduler,
        operation,
        operation === ObjectNames.list || operation === ObjectNames.removeByPrefix ? undefined : 1,
        () =>
          runWithConcurrency(
            {
              store: this.#base,
              options: context,
              execute: (actual, loop) =>
                this.#ports.execution.run({ operation, input, ctx: actual }, (next) => {
                  captured = next
                  return loop()
                })
            },
            {
              attempt: async (attempt) => ({
                status: 'committed',
                value: await invoke(captured, attempt).catch((error: unknown) => {
                  throw normalizeObjectError(error)
                })
              })
            }
          )
      )
    })

  /** Decode a bound cursor before native listing, never forwarding opaque caller text to S3. */
  #afterKey = (after: string | undefined, prefix: string): string | undefined => {
    if (after === undefined) return undefined
    try {
      const cursor = JSON.parse(new TextDecoder().decode(base64ToBytes(after))) as {
        id?: unknown
        org?: unknown
        prefix?: unknown
        key?: unknown
      }
      if (
        cursor.id !== this.#backend.identity ||
        cursor.org !== this.#orgId ||
        cursor.prefix !== prefix ||
        typeof cursor.key !== 'string'
      )
        throw invalidArgument(new Error(ObjectErrorText.cursor))
      if (!this.#logical(cursor.key).startsWith(prefix)) throw invalidArgument()
      return cursor.key
    } catch (cause) {
      throw invalidArgument(cause)
    }
  }

  /** One native page retains lexical identity and its already-organized query binding. */
  #page = async (
    options: ReturnType<typeof snapshotStorageBlobList>,
    context: IOperationContext
  ) => {
    const result = await this.#backend.native.list(
      hex(encodeStorageOrgStringPrefix(this.#orgId, options.prefix, ObjectNames.backend)),
      this.#afterKey(options.after, options.prefix),
      options.limit,
      context
    )
    /** Physical keys are mapped into this organization before publication. */
    const items = result.items.map((entry) => ({
      ...entry.info,
      key: this.#logical(entry.wireKey)
    }))
    return {
      items,
      ...(result.next === undefined
        ? {}
        : {
            next: bytesToBase64(
              new TextEncoder().encode(
                JSON.stringify({
                  id: this.#backend.identity,
                  org: this.#orgId,
                  prefix: options.prefix,
                  key: result.next
                })
              )
            )
          })
    }
  }

  /** Store content using the invoking organization and its original operation context. */
  put: IBlobApi['put'] = async (key, body, options) => {
    /** Body bytes and write conditions must not change while key-lock admission awaits. */
    const captured = snapshotStorageBlobPut(key, body, options, ObjectNames.backend)
    return this.#run(ObjectNames.put, captured, captured.options.ctx, (input, context) => {
      const accepted =
        input === captured
          ? input
          : snapshotStorageBlobPut(input.key, input.body, input.options, ObjectNames.backend)
      return this.#backend.native.put(this.#wire(accepted.key), accepted.key, accepted.body, {
        ...accepted.options,
        ctx: context
      })
    })
  }

  /** Open one content resource and retain it until native cleanup completes. */
  get: IBlobApi['get'] = async (key, options) => {
    /** Ranges must remain the accepted range while native reads await admission. */
    const captured = snapshotStorageBlobGet(key, options, ObjectNames.backend)
    return this.#run(ObjectNames.get, captured, captured.options.ctx, async (input, context) => {
      const accepted =
        input === captured
          ? input
          : snapshotStorageBlobGet(input.key, input.options, ObjectNames.backend)
      const result = await this.#backend.native.get(this.#wire(accepted.key), accepted.key, {
        ...accepted.options,
        ctx: context
      })
      if (!result) return undefined
      const object = createStorageBlobObject({ ...result.info, key: accepted.key }, result.source, {
        backend: ObjectNames.backend,
        close: result.close,
        normalizeFailure: normalizeObjectError,
        report: this.#backend.report,
        onSettled: () => {
          this.#backend.reads.release(object)
        }
      })
      this.#backend.reads.own(object, { force: () => object.dispose() })
      return object
    })
  }

  /** Read object metadata without opening a content stream. */
  head: IBlobApi['head'] = async (key, ctx) => {
    assertStringStorageKey(key, ObjectNames.backend)
    return this.#run(ObjectNames.head, key, ctx, (input, context) =>
      this.#backend.native.head(this.#wire(input), input, context)
    )
  }

  /** Remove one object through the original backend operation. */
  remove: IBlobApi['remove'] = async (key, ctx) => {
    assertStringStorageKey(key, ObjectNames.backend)
    return this.#run(ObjectNames.remove, key, ctx, (input, context) =>
      this.#backend.native.remove(this.#wire(input), context)
    )
  }

  /** Return one page with an organization-bound cursor. */
  list: IBlobApi['list'] = async (options, ctx) => {
    /** A page retains its accepted prefix, cursor and limit across async native listing. */
    const captured = snapshotStorageBlobList(options, ctx, ObjectNames.backend)
    this.#afterKey(captured.after, captured.prefix)
    return this.#run(ObjectNames.list, captured, captured.ctx, (input, context) =>
      this.#page(
        input === captured ? input : snapshotStorageBlobList(input, context, ObjectNames.backend),
        context
      )
    )
  }

  /** Remove matching objects in native page order without changing storage ownership. */
  removeByPrefix: IBlobApi['removeByPrefix'] = async (prefix, ctx) => {
    assertStringStorageKey(prefix, ObjectNames.backend)
    return this.#run(ObjectNames.removeByPrefix, prefix, ctx, async (input, context) => {
      let count = 0
      let after: string | undefined
      for (;;) {
        throwIfAborted(context.signal)
        const result = await this.#backend.native.list(
          hex(encodeStorageOrgStringPrefix(this.#orgId, input, ObjectNames.backend)),
          after,
          this.#backend.native.kind === 'fs' ? Number.MAX_SAFE_INTEGER : 100,
          context
        )
        for (const entry of result.items)
          if (await this.#backend.native.remove(entry.wireKey, context)) count++
        if (result.next === undefined) return count
        after = result.next
      }
    })
  }
}
