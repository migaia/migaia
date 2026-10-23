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
/** Each installed backend owns native resources once; immutable org stores only borrow them. */
export async function createObjectBackend(driver: IObjectDriver, core: IStoragePluginCore) {
  /** Native resource ownership and release order stay in the existing lifecycle owner. */
  const resources = createLifecycleScope()
  /** Unconsumed and active get resources close before the native driver/client. */
  const reads = createLifecycleScope()
  /** Lock acquisition remains the host's original provider and shared concurrency loop. */
  const locks = core.createKeyLockPort()
  /** Physical driver is initialized before publication and disposed only once. */
  let native!: IObjectNative
  /** Original organization stores have fixed identity and never change a global current-org slot. */
  const stores = new Map<string, { store: IObjectStore; installer: ICapabilityInstallPort }>()
  /** Every opaque cursor remains bound to this installed native backend identity. */
  const identity = crypto.randomUUID()
  /** Symbol cleanup has a separate cached reporting Promise. */
  let symbolic: Promise<void> | undefined
  /**
   * Existing controller seals admission, drains operations, then releases original lifecycle
   * resources.
   */
  const controller = core.createChangeController({
    backend: ObjectNames.backend,
    finalize: async () => {
      try {
        await resources.dispose()
      } catch (error) {
        throw normalizeObjectError(error)
      } finally {
        stores.clear()
      }
    }
  })
  /** The original final diagnostic adapter never receives user content through operation payloads. */
  const report = (error: unknown): void => {
    core.stageBindings.backendStages.report(error)
  }

  /** Return one fixed organization projection using original host execution and observation ports. */
  const forOrg = (orgId: string) => {
    controller.assertLive()
    const existing = stores.get(orgId)
    if (existing) return existing
    const ports = core.getOrgContext(orgId)
    let installer!: ICapabilityInstallPort
    let store!: IObjectStore
    const base: IStorageBase & { readonly backend: 'object' } = {
      backend: ObjectNames.backend,
      capabilities: Object.freeze({
        syncRead: false,
        binary: false,
        records: false,
        transactions: false,
        iteration: false,
        secondaryIndexes: false,
        changeFeed: false,
        maxValueBytes: undefined,
        opaqueEntries: false
      }),
      dispose: () => controller.dispose(),
      [Symbol.asyncDispose]: () => (symbolic ??= controller.dispose().then(undefined, report))
    }
    /** This registers the original concurrency owner without granting a transaction capability. */
    createTransactionOwner(base, (error) => normalizeObjectError(error) as never, {
      concurrencyStages: ports.stageBindings.concurrencyStages(base as IStorageStore<never>)
    })
    /** Logical strings receive exactly one canonical organization envelope. */
    const wire = (key: string): string => {
      assertStringStorageKey(key, ObjectNames.backend)
      return hex(encodeOrderedStorageKey(prefixStorageOrgKey(orgId, key), ObjectNames.backend))
    }
    /** Returned physical keys are checked and unwrapped by the same organization owner. */
    const logical = (key: string): string => {
      try {
        const result = unprefixStorageOrgKey(
          orgId,
          decodeOrderedStorageKey(unhex(key), ObjectNames.backend)
        )
        if (typeof result !== 'string') throw invalidArgument()
        return result
      } catch (error) {
        throw objectError(ObjectErrorCode.dataInvalid, error)
      }
    }
    /** Resource admission shares one original controller lease until the native operation settles. */
    const admitted = <T>(
      ctx: IOperationContext | undefined,
      invoke: (context: IOperationContext) => Promise<T>
    ): Promise<T> => {
      controller.assertLive()
      /** Invalid context must fail before retaining a lease that native work would never release. */
      const context = snapshotOperationContext(ctx)
      const release = controller.beginMutation()
      const cancellation = createAbortController()
      const unsubscribe: (() => void)[] = []
      try {
        unsubscribe.push(
          subscribeToAbort(
            context?.signal,
            () => cancellation.abort(readAbortReason(context?.signal)),
            report
          )
        )
        unsubscribe.push(
          subscribeToAbort(
            controller.closingSignal,
            () => cancellation.abort(readAbortReason(controller.closingSignal)),
            report
          )
        )
      } catch (error) {
        for (const stop of unsubscribe) stop()
        release()
        throw error
      }
      return Promise.resolve()
        .then(() => invoke({ ...context, signal: cancellation.signal, orgId }))
        .finally(() => {
          for (const stop of unsubscribe) stop()
          release()
        })
    }
    /** Observe one public operation and invoke the existing host pipeline exactly once. */
    const run = <I, T>(
      operation: string,
      input: I,
      ctx: IOperationContext | undefined,
      invoke: (input: I, ctx: IOperationContext) => Promise<T>
    ): Promise<T> =>
      admitted(ctx, (context) => {
        let captured = input
        return observeStorageBatch(
          ports.stageBindings.operationStages(store as IStorageStore<never>),
          systemScheduler,
          operation,
          operation === ObjectNames.list || operation === ObjectNames.removeByPrefix
            ? undefined
            : 1,
          () =>
            runWithConcurrency(
              {
                store: base,
                options: context,
                execute: (actual, loop) =>
                  ports.execution.run({ operation, input, ctx: actual }, (next) => {
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
    const afterKey = (after: string | undefined, prefix: string): string | undefined => {
      if (after === undefined) return undefined
      try {
        const cursor = JSON.parse(new TextDecoder().decode(base64ToBytes(after))) as {
          id?: unknown
          org?: unknown
          prefix?: unknown
          key?: unknown
        }
        if (
          cursor.id !== identity ||
          cursor.org !== orgId ||
          cursor.prefix !== prefix ||
          typeof cursor.key !== 'string'
        )
          throw invalidArgument(new Error(ObjectErrorText.cursor))
        if (!logical(cursor.key).startsWith(prefix)) throw invalidArgument()
        return cursor.key
      } catch (cause) {
        throw invalidArgument(cause)
      }
    }
    /** One native page retains lexical identity and its already-organized query binding. */
    const page = async (
      options: ReturnType<typeof snapshotStorageBlobList>,
      context: IOperationContext
    ) => {
      const result = await native.list(
        hex(encodeStorageOrgStringPrefix(orgId, options.prefix, ObjectNames.backend)),
        afterKey(options.after, options.prefix),
        options.limit,
        context
      )
      const items = Object.freeze(
        result.items.map((entry) => Object.freeze({ ...entry.info, key: logical(entry.wireKey) }))
      )
      return Object.freeze({
        items,
        ...(result.next === undefined
          ? {}
          : {
              next: bytesToBase64(
                new TextEncoder().encode(
                  JSON.stringify({
                    id: identity,
                    org: orgId,
                    prefix: options.prefix,
                    key: result.next
                  })
                )
              )
            })
      })
    }
    const api: IBlobApi = {
      async put(key, body, options) {
        const captured = snapshotStorageBlobPut(key, body, options, ObjectNames.backend)
        return run(ObjectNames.put, captured, captured.options.ctx, (input, context) => {
          const accepted =
            input === captured
              ? input
              : snapshotStorageBlobPut(input.key, input.body, input.options, ObjectNames.backend)
          return native.put(wire(accepted.key), accepted.key, accepted.body, {
            ...accepted.options,
            ctx: context
          })
        })
      },
      async get(key, options) {
        const captured = snapshotStorageBlobGet(key, options, ObjectNames.backend)
        return run(ObjectNames.get, captured, captured.options.ctx, async (input, context) => {
          const accepted =
            input === captured
              ? input
              : snapshotStorageBlobGet(input.key, input.options, ObjectNames.backend)
          const result = await native.get(wire(accepted.key), accepted.key, {
            ...accepted.options,
            ctx: context
          })
          if (!result) return undefined
          const object = createStorageBlobObject(
            { ...result.info, key: accepted.key },
            result.source,
            {
              backend: ObjectNames.backend,
              close: result.close,
              normalizeFailure: normalizeObjectError,
              report,
              onSettled: () => {
                reads.release(object)
              }
            }
          )
          reads.own(object, { force: () => object.dispose() })
          return object
        })
      },
      async head(key, ctx) {
        assertStringStorageKey(key, ObjectNames.backend)
        return run(ObjectNames.head, key, ctx, (input, context) =>
          native.head(wire(input), input, context)
        )
      },
      async remove(key, ctx) {
        assertStringStorageKey(key, ObjectNames.backend)
        return run(ObjectNames.remove, key, ctx, (input, context) =>
          native.remove(wire(input), context)
        )
      },
      async list(options, ctx) {
        const captured = snapshotStorageBlobList(options, ctx, ObjectNames.backend)
        afterKey(captured.after, captured.prefix)
        return run(ObjectNames.list, captured, captured.ctx, (input, context) =>
          page(
            input === captured
              ? input
              : snapshotStorageBlobList(input, context, ObjectNames.backend),
            context
          )
        )
      },
      async removeByPrefix(prefix, ctx) {
        assertStringStorageKey(prefix, ObjectNames.backend)
        return run(ObjectNames.removeByPrefix, prefix, ctx, async (input, context) => {
          let count = 0
          let after: string | undefined
          for (;;) {
            throwIfAborted(context.signal)
            const result = await native.list(
              hex(encodeStorageOrgStringPrefix(orgId, input, ObjectNames.backend)),
              after,
              native.kind === 'fs' ? Number.MAX_SAFE_INTEGER : 100,
              context
            )
            for (const entry of result.items)
              if (await native.remove(entry.wireKey, context)) count++
            if (result.next === undefined) return count
            after = result.next
          }
        })
      }
    }
    /**
     * Features already have one host execution; this finite private callback supplies only
     * observation.
     */
    Object.defineProperty(base, featureObservation, {
      value: <T>(operation: string, ctx: IOperationContext | undefined, invoke: () => Promise<T>) =>
        admitted(ctx, (context) =>
          observeStorageBatch(
            ports.stageBindings.operationStages(store as IStorageStore<never>),
            systemScheduler,
            operation,
            1,
            async () => {
              throwIfAborted(context.signal)
              return invoke()
            }
          )
        )
    })
    store = provideCapabilities(base, [implement(blob, api)] as const, {
      onInstaller: (port) => {
        installer = port
      }
    })
    const result = { store, installer }
    stores.set(orgId, result)
    return result
  }
  const root = forOrg(core.defaultOrgId)
  try {
    native = await readObjectDriver(driver)({
      report,
      lock: (key, ctx, run) => {
        const physical = forOrg(ctx?.orgId ?? core.defaultOrgId)
        return runWithConcurrency(
          {
            store: physical.store,
            options: (ctx ?? {}) as ITransactionOptions,
            lock: () => [lockKey.bytes(key)]
          },
          {
            attempt: (attempt) =>
              locks.attempt(
                attempt,
                { status: 'held', owner: identity, scope: 'local', since: Date.now() },
                { attempt: async () => ({ status: 'committed', value: await run() }) },
                core
                  .getOrgContext(ctx?.orgId ?? core.defaultOrgId)
                  .stageBindings.concurrencyStages(physical.store as IStorageStore<never>),
                controller.closingSignal
              )
          }
        )
      }
    })
    /** Native resources are the final release, after all opened content and original locks close. */
    resources.own(native, { force: () => native.dispose() })
    resources.own(locks, { force: () => locks.dispose() })
    resources.own(reads, {
      force: async () => {
        await reads.dispose()
      }
    })
  } catch (error) {
    for (const cleanup of await Promise.allSettled([
      locks.dispose(),
      reads.dispose(),
      controller.dispose()
    ]))
      if (cleanup.status === 'rejected') report(cleanup.reason)
    throw normalizeObjectError(error)
  }
  return {
    ...root,
    native,
    controller,
    orgBinding: {
      backend: (orgId: string) => forOrg(orgId).store,
      drop: async (orgId: string) => {
        await forOrg(orgId).store.use(blob).removeByPrefix('')
      }
    },
    address: (key: string, ctx?: IOperationContext) => {
      controller.assertLive()
      assertStringStorageKey(key, ObjectNames.backend)
      const context = snapshotOperationContext(ctx)
      return native.address(
        hex(
          encodeOrderedStorageKey(
            prefixStorageOrgKey(context?.orgId ?? core.defaultOrgId, key),
            ObjectNames.backend
          )
        )
      )
    }
  }
}
