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
import { invalidArgument, normalizeTransactionFailure } from './errors.js'
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
/** Mutable native draft facts belong to one named attempt; scopes borrow this owner. */
type ISparqlAttemptContext = {
  readonly ports: ISparqlAttemptPorts
  readonly draft: ISparqlDraft
  readonly present: Map<string, IQuad>
  readonly absent: Map<string, IQuad>
  mode: 'rdf' | 'raw' | undefined
  raw: string | undefined
  access: ISparqlDraftAccess
}
/** One isolated attempt registers its native scope with the original transaction owner. */
export function runSparqlAttempt<R>(
  ports: ISparqlAttemptPorts,
  run: (scope: ISparqlTransactionScope, draft: ISparqlDraft, access: ISparqlDraftAccess) => R
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  /** Initialization preserves the original draft and precondition order before any callback escapes. */
  const context = {
    ports,
    draft: new Map(),
    present: new Map(),
    absent: new Map(),
    mode: undefined,
    raw: undefined
  } as ISparqlAttemptContext
  context.access = createSparqlDraftAccess(context)
  return executeSparqlAttempt(context, run)
}
/** Accepted user work, commit and cleanup remain in the original owner ordering. */
async function executeSparqlAttempt<R>(
  context: ISparqlAttemptContext,
  run: (scope: ISparqlTransactionScope, draft: ISparqlDraft, access: ISparqlDraftAccess) => R
): Promise<IConcurrencyAttempt<Awaited<R>>> {
  /**
   * One original transaction owner registers the fresh scope, admission and stage observation in
   * that order.
   */
  const scope = createSparqlScope(context),
    control = context.ports.owner.register(scope, {
      context: context.ports.context,
      createScope: () => createSparqlScope(context),
      onFailure: () => undefined,
      beforeCommit: (current) => {
        context.ports.assertLive()
        throwIfAborted(context.ports.context.signal)
        void context.ports.stages(current).beforeCommit?.()
      }
    }),
    stage = context.ports.stages(scope)
  try {
    void stage.beforeTransaction?.()
    void stage.onTransactionStart?.()
    /** The original native or user result is retained until its accepted write/read branch settles. */
    const value = await runTransactionOperation(scope, (current) =>
      run(current, context.draft, context.access)
    )
    control.stopAdmission()
    await control.runFinalizers()
    /** Only an actual draft, raw update or precondition requires a native commit. */
    const modifying =
      context.raw !== undefined ||
      context.draft.size > 0 ||
      context.present.size > 0 ||
      context.absent.size > 0
    if (
      modifying &&
      !(await context.ports.commit(context.draft, context.present, context.absent, context.raw))
    ) {
      void stage.afterRollback?.('WRITE_CONFLICT')
      return { status: 'conflict', phase: 'commit', keys: [], holder: undefined }
    }
    void stage.afterCommit?.(context.draft.size)
    return { status: 'committed', value }
  } catch (error) {
    /** The original failure remains the primary cause through rollback or terminal writer poisoning. */
    const failure = normalizeTransactionFailure(error)
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
/** Records invalid scope work in the original first-error owner. */
function failSparqlAttempt(
  context: ISparqlAttemptContext,
  scope: ISparqlTransactionScope,
  error: unknown
): never {
  void runTransactionOperation(scope, () => {
    throw error
  })
  throw error
}
/** One attempt permits one RDF context.draft or one context.raw native update. */
function claimSparqlAttempt(context: ISparqlAttemptContext, kind: 'rdf' | 'raw'): void {
  if (context.mode !== undefined && (context.mode !== kind || kind === 'raw'))
    throw invalidArgument()
  context.mode = kind
}
/** Public RDF operations and selected query writes share the same canonical context.draft writer. */
/** Fresh complete scopes are created only by the original owner for accepted operations/finalizers. */
/** Logical organization state is passed to named query, mutation and transaction jobs. */
type ISparqlScopeContext = {
  /** Original context belongs to this physical namespace. */
  readonly context: ISparqlAttemptContext

  scope: ISparqlTransactionScope

  api: ISparqlTxRdf

  native: ReturnType<typeof createSparqlTag>

  /** The actual context.raw scope exposes only update, while pure tools remain the shared originals. */
  tag: ISparqlTxUpdateApi

  projected: object | undefined
}
function createSparqlScope(context: ISparqlAttemptContext): ISparqlTransactionScope {
  /** Initialize physical owners in original order before a store escapes. */
  const scopeContext = { context } as ISparqlScopeContext
  scopeContext.api = {
    add: (quads) => write(scopeContext, SparqlText.add, quads, true),
    delete: (quads) => write(scopeContext, SparqlText.delete, quads, false),
    expect: (quads) => expect(scopeContext, quads, scopeContext.context.present),
    expectAbsent: (quads) => expect(scopeContext, quads, scopeContext.context.absent),
    match: (pattern) => {
      try {
        assertTransactionOwner(scopeContext.context.ports.base, scopeContext.scope)
        claimSparqlAttempt(scopeContext.context, 'rdf')
        return scopeContext.context.ports.query(
          pattern,
          scopeContext.scope,
          scopeContext.context.draft,
          scopeContext.context.access
        )
      } catch (error) {
        return failSparqlAttempt(scopeContext.context, scopeContext.scope, error)
      }
    }
  }
  scopeContext.native = createSparqlTag({
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
      runTransactionOperation(scopeContext.scope, (current) =>
        scopeContext.context.ports.ports.execution.run(
          {
            operation: SparqlText.rawUpdate,
            input: prepare,
            scope: current,
            ctx: scopeContext.context.ports.context
          },
          async (input) => {
            if (!scopeContext.context.ports.hasAtomicUpdate())
              throw new StorageContractError(StorageContractErrorCode.unsupported, {
                backend: SparqlText.backend
              })
            claimSparqlAttempt(scopeContext.context, 'raw')
            scopeContext.context.raw = input()
          }
        )
      )
  })
  scopeContext.tag = Object.assign(
    (strings: TemplateStringsArray, ...values: readonly ISparqlInput[]) => {
      try {
        assertTransactionOwner(scopeContext.context.ports.base, scopeContext.scope)
        /** The original tag owns fragment admission and update execution for this accepted scope. */
        const query = scopeContext.native(strings, ...values)
        return {
          update: (ctx?: never) =>
            ctx === undefined
              ? query.update()
              : runTransactionOperation(scopeContext.scope, () => {
                  throw invalidArgument()
                })
        }
      } catch (error) {
        return failSparqlAttempt(scopeContext.context, scopeContext.scope, error)
      }
    },
    {
      var: scopeContext.native.var,
      join: scopeContext.native.join,
      empty: scopeContext.native.empty
    }
  ) as ISparqlTxUpdateApi

  scopeContext.scope = {
    use: ((capability: typeof rdf | typeof sparql) =>
      use(scopeContext, capability)) as ISparqlTransactionScope['use']
  }
  scopeContext.projected = scopeContext.context.ports.ports.createTransactionApi(scopeContext.scope)

  if (scopeContext.projected !== undefined)
    Object.defineProperty(scopeContext.scope, 'api', {
      value: scopeContext.projected,
      enumerable: true
    })
  return scopeContext.scope
}

/**
 * Pipeline replacement is captured by the same ground validator before it reaches this
 * context.draft.
 */
function write(
  scopeContext: ISparqlScopeContext,
  name: string,
  quads: readonly IQuad[],
  add: boolean
): Promise<void> {
  return runTransactionOperation(scopeContext.scope, (current) => {
    /**
     * This accepted input is retained across native, pipeline or rendering awaits; caller mutation
     * must not change that accepted operation.
     */
    const captured = captureQuads(quads)
    return scopeContext.context.ports.ports.execution.run(
      { operation: name, input: captured, scope: current, ctx: scopeContext.context.ports.context },
      async (input) => {
        /** The original transaction stage owner receives callbacks in its established order. */
        const stage = scopeContext.context.ports.stages(current)
        void stage.beforeTxOperation?.(name)
        scopeContext.context.access.write(current, input, add)
        void stage.afterTxOperation?.(name)
      }
    )
  })
}

/**
 * Captures precondition quads before commit and records rejection through the original first-error
 * owner.
 */
function expect(
  scopeContext: ISparqlScopeContext,
  quads: readonly IQuad[],
  target: Map<string, IQuad>
): void {
  try {
    assertTransactionOwner(scopeContext.context.ports.base, scopeContext.scope)
    /**
     * This accepted input is retained across native, pipeline or rendering awaits; caller mutation
     * must not change that accepted operation.
     */
    const captured = captureQuads(quads)
    claimSparqlAttempt(scopeContext.context, 'rdf')
    for (const quad of captured) target.set(quadIdentity(quad), quad)
  } catch (error) {
    failSparqlAttempt(scopeContext.context, scopeContext.scope, error)
  }
}

/** Returns only capabilities declared by this existing native transaction scope. */
function use(
  scopeContext: ISparqlScopeContext,
  capability: typeof rdf | typeof sparql
): ISparqlTxRdf | ISparqlTxUpdateApi {
  assertTransactionOwner(scopeContext.context.ports.base, scopeContext.scope)
  if (capability === rdf) return scopeContext.api
  if (capability === sparql) return scopeContext.tag
  throw invalidArgument()
}

/** Creates only adapters to the existing attempt context.draft owner. */
function createSparqlDraftAccess(context: ISparqlAttemptContext): ISparqlDraftAccess {
  return {
    claim(scope) {
      assertTransactionOwner(context.ports.base, scope)
      throwIfAborted(context.ports.context.signal)
      claimSparqlAttempt(context, 'rdf')
    },
    write(scope, quads, add) {
      /**
       * This accepted input is retained across native, pipeline or rendering awaits; caller
       * mutation must not change that accepted operation.
       */
      const captured = captureQuads(quads)
      context.access.claim(scope)
      for (const quad of captured) context.draft.set(quadIdentity(quad), { quad, add })
    }
  }
}
