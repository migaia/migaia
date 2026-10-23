import { createLifecycleScope, createAbortController } from '@migaia/lifecycle'
import {
  rdf,
  sparql,
  implement,
  provideCapabilities,
  createSparqlTag,
  createRdfQuery,
  readTransactionOperationContext,
  runTransactionOperation,
  assertTransactionCallback,
  assertTransactionOwner,
  createTransactionOwner,
  createTransactionBuilder,
  createStorageIteratorLifetime,
  runWithConcurrency,
  resolveConcurrencyPolicy,
  ConcurrencyPolicy,
  StorageContractError,
  StorageContractErrorCode,
  snapshotOperationContext,
  snapshotStorageRdfPattern,
  snapshotStorageRdfQuad,
  getStorageOrgGraphPrefix,
  prefixStorageOrgGraph,
  unprefixStorageOrgGraph,
  sparqlFragment,
  term,
  type IQuad,
  type IRdfApi,
  type IOperationContext,
  type ITransactionOptions,
  type IConcurrencyAttempt,
  type ICapabilityInstallPort,
  type IStorageIterator,
  type IStorageKey,
  type IRdfQuerySource,
  type IRdfQueryMutation,
  type IRdfQuery,
  type IConcurrencyPolicy
} from '@migaia/storage-contract'
import { systemScheduler } from '@migaia/utils/scheduler'
import { walkErrorCauses } from '@migaia/utils/error'
import {
  observeStorageBatch,
  throwIfAborted,
  subscribeToAbort,
  readAbortReason
} from '@migaia/storage-host/authoring/backend'
import type { IStoragePluginCore } from '@migaia/storage-host'
import {
  capture,
  invalidArgument,
  normalizeSparqlError,
  normalizeTransactionFailure,
  sparqlError
} from './errors.js'
import { ERROR_SOURCE, SparqlErrorCode } from './error-code.js'
import { SparqlText } from './text.js'
import { parseSparqlResults } from './results.js'
import { parseRdfDocument } from './ntriples.js'
import { renderFragment } from './render.js'
import { readHttpRoute } from './http-route.js'
import { captureQuads, matchesQuad, matchFragment, quadFragment, quadIdentity } from './rdf.js'
import {
  runSparqlAttempt,
  type ISparqlDraft,
  type ISparqlOwner,
  type ISparqlDraftAccess
} from './transaction.js'
import { nativeFeaturePort, type ISparqlNativeFeaturePort } from './native-feature.js'
import { snapshotGraphTarget } from './graph-store.js'
import type { ISparqlEndpoint, ISparqlAbortSignal, IRdfGraphTarget } from './endpoint.js'
import type { ISparqlBase, ISparqlStore, ISparqlTransactionScope } from './types.js'
import type {} from './hooks.js'
/** Native input methods are captured without granting the backend ownership of the endpoint. */
export function captureEndpoint(endpoint: ISparqlEndpoint): ISparqlEndpoint {
  return capture(() => {
    const query = endpoint.query,
      update = endpoint.update,
      atomic = endpoint.atomicUpdate
    if (
      typeof query !== 'function' ||
      typeof update !== 'function' ||
      (atomic !== undefined && typeof atomic !== 'function')
    )
      throw invalidArgument()
    return endpoint
  })
}
/**
 * Install one physical endpoint and the original owners for admission, resources and transaction
 * policy.
 */
export function createSparqlBackend(endpoint: ISparqlEndpoint, core: IStoragePluginCore) {
  const resources = createLifecycleScope(),
    stores = new Map<
      string,
      { store: ISparqlStore; installer: ICapabilityInstallPort; drop: () => Promise<void> }
    >()
  let poisoned: Error | undefined, symbolic: Promise<void> | undefined
  const controller = core.createChangeController({
    backend: SparqlText.backend,
    finalize: async () => {
      try {
        await resources.dispose()
      } finally {
        stores.clear()
      }
    }
  })
  const report = (error: unknown): void => {
    core.stageBindings.backendStages.report(error)
  }
  const assertWrite = (): void => {
    controller.assertLive()
    if (poisoned) throw poisoned
  }
  /** Unknown native modification is terminal for this installed writer, never for read access. */
  const uncertain = (error: unknown): Error => {
    const failure =
      error instanceof Error &&
      'source' in error &&
      error.source === ERROR_SOURCE &&
      'code' in error &&
      error.code === SparqlErrorCode.commitUnknown
        ? error
        : sparqlError(SparqlErrorCode.commitUnknown, error)
    poisoned ??= failure
    return failure
  }
  /** Each organization projection owns only logical mapping and reuses the physical native endpoint. */
  const forOrg = (orgId: string) => {
    controller.assertLive()
    const existing = stores.get(orgId)
    if (existing) return existing
    const ports = core.getOrgContext(orgId),
      prefix = getStorageOrgGraphPrefix(orgId),
      identity = { backendId: core.getBackendId(), backend: SparqlText.backend, orgId }
    let store!: ISparqlStore, installer!: ICapabilityInstallPort
    /** Native sends expose only the actual sanitized HTTP route and aggregate request statistics. */
    const observeNative = async <T>(
      kind: 'query' | 'update' | 'graph',
      method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
      invoke: () => Promise<T>
    ): Promise<T> => {
      const path = readHttpRoute(endpoint, kind),
        start = systemScheduler.now()
      let status: number | undefined
      try {
        return await invoke()
      } catch (error) {
        for (const cause of walkErrorCauses(error)) {
          if (
            cause &&
            typeof cause === 'object' &&
            'status' in cause &&
            typeof cause.status === 'number'
          ) {
            status = cause.status
            break
          }
        }
        throw error
      } finally {
        if (path !== undefined)
          core.emit(SparqlText.onHttpRequest, () => ({
            ...identity,
            method,
            path,
            status,
            elapsedMs: systemScheduler.now() - start
          }))
      }
    }
    /** Read cancellation borrows the original controller and operation signal without another timer. */
    const reading = async <T>(
      ctx: IOperationContext,
      invoke: (signal: ISparqlAbortSignal) => Promise<T>
    ): Promise<T> => {
      const cancellation = createAbortController(),
        stops: (() => void)[] = []
      try {
        stops.push(
          subscribeToAbort(
            ctx.signal,
            () => cancellation.abort(readAbortReason(ctx.signal)),
            report
          )
        )
        stops.push(
          subscribeToAbort(
            controller.closingSignal,
            () => cancellation.abort(readAbortReason(controller.closingSignal)),
            report
          )
        )
        throwIfAborted(cancellation.signal)
        return await invoke(cancellation.signal)
      } finally {
        for (const stop of stops) stop()
      }
    }
    /** Definite native request failures remain definite; every other sent modification is unknown. */
    const writing = async (invoke: () => Promise<void>, poison = true): Promise<void> => {
      try {
        await invoke()
      } catch (error) {
        if (
          error instanceof Error &&
          'source' in error &&
          error.source === ERROR_SOURCE &&
          'code' in error &&
          error.code === SparqlErrorCode.requestFailed
        )
          throw error
        if (poison) throw uncertain(error)
        throw normalizeSparqlError(error)
      }
    }
    const queryText = (
      text: string,
      accept: typeof SparqlText.json | typeof SparqlText.triples,
      ctx: IOperationContext,
      protect = true
    ) =>
      observeNative('query', SparqlText.post, () =>
        protect
          ? reading(ctx, (signal) => endpoint.query(text, accept, signal))
          : endpoint.query(text, accept, ctx.signal)
      ).catch((error: unknown) => {
        throw normalizeSparqlError(error)
      })
    /** Canonical ground SELECT returns logical graph terms; blank/native marker rows never leak. */
    const readQuads = async (
      pattern: Partial<IQuad>,
      ctx: IOperationContext,
      draft?: ISparqlDraft
    ): Promise<readonly IQuad[]> => {
      const captured = snapshotStorageRdfPattern(pattern, SparqlText.backend),
        body = await renderFragment(matchFragment(orgId, captured, prefix)),
        rows = parseSparqlResults(await queryText(body, SparqlText.json, ctx), 'select'),
        result = new Map<string, IQuad>()
      try {
        for (const row of rows) {
          if (row.g?.termType !== 'NamedNode') throw invalidArgument()
          const quad = snapshotStorageRdfQuad(
            {
              subject: row.s!,
              predicate: row.p!,
              object: row.o!,
              graph: unprefixStorageOrgGraph(orgId, row.g)
            } as IQuad,
            SparqlText.backend
          )
          result.set(quadIdentity(quad), quad)
        }
      } catch (error) {
        throw sparqlError(SparqlErrorCode.responseInvalid, error)
      }
      if (draft)
        for (const [key, value] of draft) {
          if (!value.add) result.delete(key)
          else if (matchesQuad(value.quad, captured)) result.set(key, value.quad)
        }
      return [...result.values()]
    }
    /** Original operation snapshots detach options before retaining an admission lease. */
    const optionsOf = (options?: ITransactionOptions): ITransactionOptions =>
      capture(() => ({
        ...snapshotOperationContext(options),
        concurrency: options?.concurrency,
        lock: options?.lock,
        orgId
      }))
    const validatePolicy = (options: ITransactionOptions): void => {
      if (options.lock !== undefined)
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: SparqlText.backend
        })
      const policy = resolveConcurrencyPolicy(base, options.concurrency)
      if (policy.locking !== 'optimistic')
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: SparqlText.backend
        })
    }
    /** One public call owns one pipeline, original policy loop and operation observation. */
    const operate = <I, T>(
      operation: string,
      input: I,
      options: ITransactionOptions | undefined,
      invoke: (input: I, ctx: IOperationContext) => Promise<IConcurrencyAttempt<T>>,
      write = false,
      pipeline = true,
      execution?: {
        readonly ctx: IOperationContext | undefined
        readonly policy: IConcurrencyPolicy | undefined
      }
    ): Promise<T> => {
      controller.assertLive()
      if (write) assertWrite()
      const captured: ITransactionOptions = execution ? (execution.ctx ?? {}) : optionsOf(options),
        policy = execution ? execution.policy : captured?.concurrency
      validatePolicy({ ...captured, concurrency: policy })
      const release = controller.beginMutation()
      return observeStorageBatch(
        ports.stageBindings.operationStages(store),
        systemScheduler,
        operation,
        undefined,
        () =>
          runWithConcurrency<T>(
            {
              store: base,
              options: captured,
              policy,
              execute: (ctx, loop) =>
                pipeline
                  ? ports.execution.run({ operation, input, ctx }, (next) => {
                      input = next
                      return loop()
                    })
                  : loop()
            },
            {
              attempt: async (ctx) => {
                throwIfAborted(ctx.signal)
                return invoke(input, ctx)
              }
            }
          )
      )
        .catch((error: unknown) => {
          throw normalizeSparqlError(error)
        })
        .finally(release)
    }
    /**
     * Transaction-bound queries register with their actual original operation view, never a copied
     * scope.
     */
    const query = (
      pattern: Partial<IQuad>,
      scope?: ISparqlTransactionScope,
      draft?: ISparqlDraft,
      access?: ISparqlDraftAccess
    ): IRdfQuery<IOperationContext | undefined> => {
      const captured = snapshotStorageRdfPattern(pattern, SparqlText.backend)
      const sourceFor = (
        boundScope?: ISparqlTransactionScope,
        boundDraft?: ISparqlDraft,
        pipeline = true
      ) => {
        const execute: IRdfQuerySource<ISparqlTransactionScope>['execute'] = (input) => {
          const current = input.operationScope ?? boundScope
          let rows: readonly IQuad[] | undefined,
            index = 0,
            loading: Promise<readonly IQuad[]> | undefined
          const advance = async (
            load: () => Promise<readonly IQuad[]>
          ): Promise<IteratorResult<readonly [IStorageKey, unknown]>> => {
            rows ??= await (loading ??= load())
            const quad = rows[index++]
            if (!quad) return { done: true, value: undefined }
            return { done: false, value: [quadIdentity(quad), quad] as const }
          }
          const close = async () => {
            rows = undefined
            loading = undefined
          }
          if (current)
            return owner.registerIterator(current, {
              next: (operationScope) =>
                advance(() =>
                  pipeline
                    ? ports.execution.run(
                        {
                          operation: SparqlText.match,
                          input: input.pattern,
                          scope: operationScope,
                          ctx: readTransactionOperationContext(operationScope)
                        },
                        async (pattern) =>
                          readQuads(
                            pattern,
                            readTransactionOperationContext(operationScope) ?? {},
                            boundDraft
                          )
                      )
                    : readQuads(
                        input.pattern,
                        readTransactionOperationContext(operationScope) ?? {},
                        boundDraft
                      )
                ),
              close
            })
          controller.assertLive()
          let iterator!: IStorageIterator<readonly [IStorageKey, unknown]>
          const lifetime = createStorageIteratorLifetime<readonly [IStorageKey, unknown]>({
            close,
            report,
            onSettled: () => {
              resources.release(iterator)
            }
          })
          iterator = {
            next: () => {
              controller.assertLive()
              if (lifetime.isClosing()) return Promise.resolve({ done: true, value: undefined })
              return lifetime.advance(() =>
                advance(() =>
                  operate(SparqlText.match, input, input.ctx, async (value, ctx) => ({
                    status: 'committed',
                    value: await readQuads(value.pattern, ctx, boundDraft)
                  }))
                )
              )
            },
            return: lifetime.returned,
            dispose: lifetime.dispose,
            [Symbol.asyncDispose]: lifetime.symbolic,
            [Symbol.asyncIterator]() {
              return this
            }
          }
          resources.own(iterator, { force: () => iterator.dispose() })
          return iterator
        }
        return execute
      }
      const execute = sourceFor(scope, draft)
      return createRdfQuery<
        IOperationContext | undefined,
        Record<never, never>,
        ISparqlTransactionScope
      >(
        {
          pushdown: { source: SparqlText.backend, operators: [], operations: [] },
          cursorSource: store,
          execute,
          mutate: (request, run) => {
            const operation =
              request.operation === 'delete' ? SparqlText.queryDelete : SparqlText.queryReplace
            /**
             * One accepted write terminal claims RDF before selection and changes only this
             * attempt's draft.
             */
            const apply = (
              current: ISparqlTransactionScope,
              state: ISparqlDraft,
              writer: ISparqlDraftAccess,
              input: IRdfQueryMutation
            ) => {
              if (input.operation !== request.operation) throw invalidArgument()
              const replacement =
                input.operation === 'replace'
                  ? snapshotStorageRdfQuad(input.newQuad, SparqlText.backend)
                  : undefined
              writer.claim(current)
              return run({
                execute: sourceFor(current, state, false),
                accept: (_key, quad) => {
                  writer.write(current, [quad], false)
                  if (replacement) writer.write(current, [replacement], true)
                  return true
                }
              })
            }
            if (scope && draft && access)
              return runTransactionOperation(scope, (current) =>
                ports.execution.run(
                  {
                    operation,
                    input: request,
                    scope: current,
                    ctx: readTransactionOperationContext(current)
                  },
                  async (input) => {
                    const stage = ports.stageBindings
                      .transactionStages(store)
                      .forTransaction(current)
                    void stage.beforeTxOperation?.(operation)
                    const count = await apply(current, draft, access, input)
                    void stage.afterTxOperation?.(operation)
                    return count
                  }
                )
              )
            return operate(
              operation,
              request,
              undefined,
              (input, ctx) =>
                attempt((current, state, writer) => apply(current, state, writer, input), ctx),
              true,
              true,
              { ctx: request.ctx, policy: request.concurrency }
            )
          }
        },
        captured,
        core.getChainMethods('rdf') as Record<never, never> | undefined
      )
    }
    /** One native conditional Modify publishes user quads and its marker atomically. */
    const commit = async (
      draft: ISparqlDraft,
      present: ReadonlyMap<string, IQuad>,
      absent: ReadonlyMap<string, IQuad>,
      raw: string | undefined,
      ctx: IOperationContext
    ): Promise<boolean> => {
      assertWrite()
      throwIfAborted(ctx.signal)
      core.emit(SparqlText.beforeSparqlUpdate, () => ({
        ...identity,
        operationCount: raw === undefined ? draft.size : 1,
        preconditionCount: present.size + absent.size
      }))
      if (raw !== undefined) {
        if (orgId !== core.defaultOrgId || typeof endpoint.atomicUpdate !== 'function')
          throw new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: SparqlText.backend
          })
        await observeNative('update', SparqlText.post, () =>
          writing(() => endpoint.atomicUpdate!(raw, ctx.signal))
        )
        return true
      }
      const marker = term.iri(SparqlText.marker + ':' + crypto.randomUUID()),
        markerGraph = term.iri(SparqlText.marker),
        predicate = term.iri(SparqlText.markerPredicate)
      const adds = sparqlFragment.join(
          [...draft.values()]
            .filter((value) => value.add)
            .map((value) => quadFragment(orgId, value.quad))
        ),
        deletes = sparqlFragment.join(
          [...draft.values()]
            .filter((value) => !value.add)
            .map((value) => quadFragment(orgId, value.quad))
        ),
        conditions = sparqlFragment.join(
          [...present.values()].map((quad) => quadFragment(orgId, quad))
        ),
        missing = sparqlFragment.join(
          [...absent.values()].map(
            (quad) => sparqlFragment`FILTER NOT EXISTS { ${quadFragment(orgId, quad)} }`
          )
        )
      const markerBody = sparqlFragment`GRAPH ${markerGraph} { ${marker} ${predicate} ${term.literal('1')} . }`,
        text = await renderFragment(
          sparqlFragment`DELETE { ${deletes} } INSERT { ${adds} ${markerBody} } WHERE { ${conditions} ${missing} }`
        )
      throwIfAborted(ctx.signal)
      await observeNative('update', SparqlText.post, () =>
        writing(() => endpoint.update(text, ctx.signal))
      )
      let exists: boolean
      try {
        exists = parseSparqlResults(
          await queryText(
            await renderFragment(sparqlFragment`ASK { ${markerBody} }`),
            SparqlText.json,
            ctx,
            false
          ),
          'ask'
        )
      } catch (error) {
        throw uncertain(error)
      }
      if (!exists) {
        core.emit(SparqlText.onPreconditionFailed, () => ({
          ...identity,
          preconditionCount: present.size + absent.size
        }))
        return false
      }
      try {
        await observeNative('update', SparqlText.post, () =>
          writing(
            async () =>
              endpoint.update(await renderFragment(sparqlFragment`DELETE DATA { ${markerBody} }`)),
            false
          )
        )
      } catch (error) {
        report(error)
      }
      return true
    }
    const base: ISparqlBase & { transaction: ISparqlStore['transaction']; tx: ISparqlStore['tx'] } =
      {
        backend: SparqlText.backend,
        capabilities: Object.freeze({
          syncRead: false,
          binary: false,
          records: false,
          transactions: true,
          iteration: false,
          secondaryIndexes: false,
          changeFeed: false,
          maxValueBytes: undefined,
          opaqueEntries: false
        }),
        dispose: () => controller.dispose(),
        [Symbol.asyncDispose]: () => (symbolic ??= controller.dispose().then(undefined, report)),
        transaction: (run, options) => {
          assertTransactionCallback(run, SparqlText.backend)
          return operate(
            SparqlText.transaction,
            run,
            options,
            (callback, ctx) => attempt(callback, ctx),
            true
          )
        },
        tx: () =>
          createTransactionBuilder(
            store,
            undefined,
            core.getChainMethods('tx') as Record<never, never> | undefined,
            { mode: 'optimistic' }
          )
      }
    let owner: ISparqlOwner
    const createOwner = () =>
      createTransactionOwner<unknown, ISparqlTransactionScope>(
        base,
        (error) => normalizeTransactionFailure(error) as Error & { source: string; code: string },
        {
          defaultPolicy: ConcurrencyPolicy.optimistic(),
          concurrencyStages: ports.stageBindings.concurrencyStages(store)
        }
      )
    const attempt = <R>(
      run: (scope: ISparqlTransactionScope, draft: ISparqlDraft, access: ISparqlDraftAccess) => R,
      ctx: IOperationContext
    ): Promise<IConcurrencyAttempt<Awaited<R>>> =>
      runSparqlAttempt(
        {
          base,
          owner,
          context: ctx,
          ports,
          assertLive: () => controller.assertLive(),
          stages: (scope) => ports.stageBindings.transactionStages(store).forTransaction(scope),
          query: (pattern, scope, draft, access) =>
            query(
              pattern,
              scope,
              draft,
              access
            ) as import('@migaia/storage-contract').IRdfQuery<undefined>,
          commit: (draft, present, absent, raw) => commit(draft, present, absent, raw, ctx),
          hasAtomicUpdate: () =>
            orgId === core.defaultOrgId && typeof endpoint.atomicUpdate === 'function'
        },
        run
      )
    const rdfApi: IRdfApi = {
      add: (quads, ctx) => {
        const captured = captureQuads(quads)
        return operate(
          SparqlText.add,
          captured,
          ctx,
          (input, context) => attempt((scope) => scope.use(rdf).add(input), context),
          true,
          false
        )
      },
      delete: (quads, ctx) => {
        const captured = captureQuads(quads)
        return operate(
          SparqlText.delete,
          captured,
          ctx,
          (input, context) => attempt((scope) => scope.use(rdf).delete(input), context),
          true,
          false
        )
      },
      match: (pattern) => query(pattern)
    }
    const raw = <T>(
      operation: string,
      prepare: () => string,
      ctx: IOperationContext | undefined,
      invoke: (text: string, context: IOperationContext) => Promise<T>,
      write = false
    ): Promise<T> => {
      if (orgId !== core.defaultOrgId)
        return Promise.reject(
          new StorageContractError(StorageContractErrorCode.unsupported, {
            backend: SparqlText.backend
          })
        )
      return operate(
        operation,
        prepare,
        ctx,
        async (input, context) => ({ status: 'committed', value: await invoke(input(), context) }),
        write
      )
    }
    const sparqlApi = createSparqlTag({
      select: (prepare, ctx) =>
        raw(SparqlText.select, prepare, ctx, async (text, context) =>
          parseSparqlResults(await queryText(text, SparqlText.json, context), 'select')
        ),
      ask: (prepare, ctx) =>
        raw(SparqlText.ask, prepare, ctx, async (text, context) =>
          parseSparqlResults(await queryText(text, SparqlText.json, context), 'ask')
        ),
      construct: (prepare, ctx) =>
        raw(SparqlText.construct, prepare, ctx, async (text, context) =>
          parseRdfDocument({
            format: SparqlText.triples,
            text: await queryText(text, SparqlText.triples, context)
          })
        ),
      update: (prepare, ctx) =>
        raw(
          SparqlText.rawUpdate,
          prepare,
          ctx,
          async (text, context) =>
            observeNative('update', SparqlText.post, () =>
              writing(() => endpoint.update(text, context.signal))
            ),
          true
        )
    })
    Object.defineProperty(base, nativeFeaturePort, {
      value: {
        run: <T>(
          operation: string,
          ctx: IOperationContext | undefined,
          write: boolean,
          method: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'DELETE',
          invoke: (
            endpoint: ISparqlEndpoint,
            signal: ISparqlAbortSignal | undefined,
            map: (target: IRdfGraphTarget) => IRdfGraphTarget
          ) => Promise<T>
        ) =>
          operate(
            operation,
            undefined,
            ctx,
            async (_input, context) => ({
              status: 'committed',
              value: await observeNative('graph', method, () => {
                const map = (target: IRdfGraphTarget): IRdfGraphTarget => {
                  const captured = snapshotGraphTarget(target)
                  return {
                    graph: prefixStorageOrgGraph(
                      orgId,
                      captured.default ? term.defaultGraph : captured.graph
                    )
                  }
                }
                if (write) return writingValue(() => invoke(endpoint, context.signal, map))
                return reading(context, (signal) => invoke(endpoint, signal, map))
              })
            }),
            write,
            false
          )
      } satisfies ISparqlNativeFeaturePort
    })
    /** Graph Store writes return native results while retaining the same uncertainty seal. */
    async function writingValue<T>(invoke: () => Promise<T>): Promise<T> {
      let value!: T
      await writing(async () => {
        value = await invoke()
      })
      return value
    }
    store = provideCapabilities(
      base,
      [
        implement(rdf, rdfApi, {
          forTransaction: (scope) => {
            assertTransactionOwner(base, scope)
            return scope.use(rdf)
          }
        }),
        implement(sparql, sparqlApi)
      ] as const,
      {
        onInstaller: (port) => {
          installer = port
        }
      }
    )
    owner = createOwner()
    /**
     * Organization removal includes raw blank documents and empty named graphs, not only ground
     * rows.
     */
    const drop = () =>
      operate(
        SparqlText.dropOrg,
        undefined,
        undefined,
        async (_input, ctx) => {
          const body = await renderFragment(
            sparqlFragment`SELECT ?g WHERE { GRAPH ?g {} FILTER(STRSTARTS(STR(?g),${term.literal(prefix)})) }`
          )
          const rows = parseSparqlResults(await queryText(body, SparqlText.json, ctx), 'select')
          const graphs = new Map<string, import('@migaia/storage-contract').IRdfNamedNode>()
          for (const row of rows) {
            if (row.g?.termType !== 'NamedNode') throw sparqlError(SparqlErrorCode.responseInvalid)
            try {
              unprefixStorageOrgGraph(orgId, row.g)
            } catch (error) {
              throw sparqlError(SparqlErrorCode.responseInvalid, error)
            }
            graphs.set(row.g.value, row.g)
          }
          if (graphs.size > 0) {
            assertWrite()
            throwIfAborted(ctx.signal)
            const text = await renderFragment(
              sparqlFragment.join(
                [...graphs.values()].map((graph) => sparqlFragment`DROP SILENT GRAPH ${graph}`),
                sparqlFragment`;`
              )
            )
            await observeNative('update', SparqlText.post, () =>
              writing(() => endpoint.update(text, ctx.signal))
            )
          }
          return { status: 'committed', value: undefined }
        },
        true
      )
    const result = { store, installer, drop }
    stores.set(orgId, result)
    return result
  }
  const root = forOrg(core.defaultOrgId)
  return {
    ...root,
    controller,
    orgBinding: {
      backend: (orgId: string) => forOrg(orgId).store,
      drop: (orgId: string) => forOrg(orgId).drop()
    },
    detect: async (signal: ISparqlAbortSignal) => {
      parseSparqlResults(await endpoint.query('ASK {}', SparqlText.json, signal), 'ask')
    }
  }
}
