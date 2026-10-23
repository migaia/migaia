import {
  rdf,
  sparql,
  createSparqlTag,
  runTransactionOperation,
  assertTransactionOwner,
  createTransactionOwner,
  StorageContractError,
  StorageContractErrorCode,
  type IQuad,
  type IOperationContext,
  type IConcurrencyAttempt,
  type IRdfQuery,
  type ISparqlInput,
  type IStorageBase,
  type ITransactionStageObserver
} from '@migaia/storage-contract'
import type { IStorageBackendOrgContext } from '@migaia/storage-host'
import { throwIfAborted } from '@migaia/storage-host/authoring/backend'
import { captureQuads, quadIdentity } from './rdf.js'
import { invalidArgument, normalizeSparqlError } from './errors.js'
import { SparqlText } from './text.js'
import type { ISparqlTransactionScope, ISparqlTxRdf, ISparqlTxUpdateApi } from './types.js'
/** Each canonical quad retains only its final native draft operation. */
export type ISparqlDraft = Map<string, { readonly quad: IQuad; readonly add: boolean }>
/** Query writes borrow these existing claim/draft closures without acquiring another scope owner. */
export type ISparqlDraftAccess = {
  claim(scope: ISparqlTransactionScope): void
  write(scope: ISparqlTransactionScope, quads: readonly IQuad[], add: boolean): void
}
/** Original owner registration is reused verbatim for every scope, operation and iterator. */
export type ISparqlOwner = ReturnType<
  typeof createTransactionOwner<unknown, ISparqlTransactionScope>
>
/** Backend ports retain actual native work; this unit adds no lifecycle, policy or execution owner. */
export type ISparqlAttemptPorts = {
  readonly base: IStorageBase
  readonly owner: ISparqlOwner
  readonly context: IOperationContext
  readonly ports: IStorageBackendOrgContext
  assertLive(): void
  stages(scope: ISparqlTransactionScope): ITransactionStageObserver
  query(
    pattern: Partial<IQuad>,
    scope: ISparqlTransactionScope,
    draft: ISparqlDraft,
    access: ISparqlDraftAccess
  ): IRdfQuery<undefined>
  commit(
    draft: ISparqlDraft,
    present: ReadonlyMap<string, IQuad>,
    absent: ReadonlyMap<string, IQuad>,
    raw: string | undefined
  ): Promise<boolean>
  hasAtomicUpdate(): boolean
}
/** One isolated attempt registers the native scope with the original transaction owner. */
export async function runSparqlAttempt<R>(
  ports: ISparqlAttemptPorts,
  run: (scope: ISparqlTransactionScope, draft: ISparqlDraft, access: ISparqlDraftAccess) => R
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  const draft: ISparqlDraft = new Map(),
    present = new Map<string, IQuad>(),
    absent = new Map<string, IQuad>()
  let mode: 'rdf' | 'raw' | undefined, raw: string | undefined
  /**
   * Every invalid native combination reaches the original first-error state before it can be
   * caught.
   */
  const fail = (scope: ISparqlTransactionScope, error: unknown): never => {
    void runTransactionOperation(scope, () => {
      throw error
    })
    throw error
  }
  const claim = (kind: 'rdf' | 'raw') => {
    if (mode !== undefined && (mode !== kind || kind === 'raw')) throw invalidArgument()
    mode = kind
  }
  /** Public RDF operations and selected query writes share the same canonical draft writer. */
  const access: ISparqlDraftAccess = {
    claim(scope) {
      assertTransactionOwner(ports.base, scope)
      throwIfAborted(ports.context.signal)
      claim('rdf')
    },
    write(scope, quads, add) {
      const captured = captureQuads(quads)
      access.claim(scope)
      for (const quad of captured) draft.set(quadIdentity(quad), { quad, add })
    }
  }
  /**
   * Fresh complete scopes are created only by the original owner for accepted
   * operations/finalizers.
   */
  const createScope = (): ISparqlTransactionScope => {
    let scope: ISparqlTransactionScope
    /** Pipeline replacement is captured by the same ground validator before it reaches this draft. */
    const write = (name: string, quads: readonly IQuad[], add: boolean): Promise<void> =>
      runTransactionOperation(scope, (current) => {
        const captured = captureQuads(quads)
        return ports.ports.execution.run(
          { operation: name, input: captured, scope: current, ctx: ports.context },
          async (input) => {
            const stage = ports.stages(current)
            void stage.beforeTxOperation?.(name)
            access.write(current, input, add)
            void stage.afterTxOperation?.(name)
          }
        )
      })
    const expect = (quads: readonly IQuad[], target: Map<string, IQuad>): void => {
      try {
        assertTransactionOwner(ports.base, scope)
        const captured = captureQuads(quads)
        claim('rdf')
        for (const quad of captured) target.set(quadIdentity(quad), quad)
      } catch (error) {
        fail(scope, error)
      }
    }
    const api: ISparqlTxRdf = {
      add: (quads) => write(SparqlText.add, quads, true),
      delete: (quads) => write(SparqlText.delete, quads, false),
      expect: (quads) => expect(quads, present),
      expectAbsent: (quads) => expect(quads, absent),
      match: (pattern) => {
        try {
          assertTransactionOwner(ports.base, scope)
          claim('rdf')
          return ports.query(pattern, scope, draft, access)
        } catch (error) {
          return fail(scope, error)
        }
      }
    }
    const native = createSparqlTag({
      select: async () => {
        throw invalidArgument()
      },
      ask: async () => {
        throw invalidArgument()
      },
      construct: async () => {
        throw invalidArgument()
      },
      update: (prepare) =>
        runTransactionOperation(scope, (current) =>
          ports.ports.execution.run(
            { operation: SparqlText.rawUpdate, input: prepare, scope: current, ctx: ports.context },
            async (input) => {
              if (!ports.hasAtomicUpdate())
                throw new StorageContractError(StorageContractErrorCode.unsupported, {
                  backend: SparqlText.backend
                })
              claim('raw')
              raw = input()
            }
          )
        )
    })
    /** The actual raw scope exposes only update, while pure tools remain the shared originals. */
    const tag = Object.assign(
      (strings: TemplateStringsArray, ...values: readonly ISparqlInput[]) => {
        try {
          assertTransactionOwner(ports.base, scope)
          const query = native(strings, ...values)
          return Object.freeze({
            update: (ctx?: never) =>
              ctx === undefined
                ? query.update()
                : runTransactionOperation(scope, () => {
                    throw invalidArgument()
                  })
          })
        } catch (error) {
          return fail(scope, error)
        }
      },
      { var: native.var, join: native.join, empty: native.empty }
    ) as ISparqlTxUpdateApi
    function use(capability: typeof rdf): ISparqlTxRdf
    function use(capability: typeof sparql): ISparqlTxUpdateApi
    function use(capability: typeof rdf | typeof sparql): ISparqlTxRdf | ISparqlTxUpdateApi {
      assertTransactionOwner(ports.base, scope)
      if (capability === rdf) return api
      if (capability === sparql) return tag
      throw invalidArgument()
    }
    scope = { use }
    const projected = ports.ports.createTransactionApi(scope)
    if (projected !== undefined)
      Object.defineProperty(scope, 'api', { value: projected, enumerable: true })
    return Object.freeze(scope)
  }
  const scope = createScope(),
    control = ports.owner.register(scope, {
      context: ports.context,
      createScope,
      onFailure: () => undefined,
      beforeCommit: (current) => {
        ports.assertLive()
        throwIfAborted(ports.context.signal)
        void ports.stages(current).beforeCommit?.()
      }
    }),
    stage = ports.stages(scope)
  try {
    void stage.beforeTransaction?.()
    void stage.onTransactionStart?.()
    const value = await runTransactionOperation(scope, (current) => run(current, draft, access))
    control.stopAdmission()
    await control.runFinalizers()
    const modifying = raw !== undefined || draft.size > 0 || present.size > 0 || absent.size > 0
    if (modifying && !(await ports.commit(draft, present, absent, raw))) {
      void stage.afterRollback?.('WRITE_CONFLICT')
      return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
    }
    void stage.afterCommit?.(draft.size)
    return { status: 'committed', value }
  } catch (error) {
    const failure = normalizeSparqlError(error)
    void stage.afterRollback?.('code' in failure ? String(failure.code) : undefined)
    throw failure
  } finally {
    try {
      await control.closeIterators()
    } finally {
      control.close()
      void stage.onTransactionClose?.()
    }
  }
}
