// SQL tag, record cursors, record sources and deadlines for the PostgreSQL store (see ./store.ts).
import {
  createBackendChangeIterator,
  createStorageIteratorLifetime,
  createSqlTag,
  asyncDisposeKey,
  snapshotKeyRange
} from '@migaia/storage-host/sdk'
import {
  StorageContractError,
  StorageContractErrorCode,
  type IStorageKey,
  type IStorageIterator,
  type IOperationContext,
  type IKeyRange,
  type ITtlTarget,
  type IRecordQuerySource,
  type ISqlExecutor,
  type ICompiledStorageSql
} from '@migaia/storage-contract'
import { observePg } from './transaction.ts'
import {
  writePg,
  removePg,
  scanPgRecords,
  prunePg,
  markPgChanged,
  type IPgState
} from './native.ts'
import { pgKey } from './codec.ts'
import { PgNames, PgOperation } from './constants.ts'
import { runPgScopeOperation, runPgRootOperation, pgOrgTtlTarget } from './store-state.ts'
import type { IPgOrganizationContext, IPgScope } from './store-state.ts'

/**
 * Native SQL compiles lazily only after original operation admission and retains its statement
 * port.
 */
export function createPgOrgSql<T>(
  organization: IPgOrganizationContext<T>,
  getScope?: () => IPgScope<T>
): ISqlExecutor {
  const execute = async (
    prepare: () => ICompiledStorageSql,
    ctx: IOperationContext | undefined
  ) => {
    const run = async (state: IPgState, current: IPgScope<T> | undefined) => {
      if (organization.orgView || organization.runtime.journal?.active())
        throw new StorageContractError(StorageContractErrorCode.unsupported, {
          backend: PgNames.backend
        })
      const compiled = prepare()
      const observer = organization.runtime.stageBindings.sqlStages(organization.store)
      const bound = current ? observer.forTransaction(current) : observer
      const started = Date.now()
      observePg(
        bound,
        'beforeSql',
        compiled.values.length,
        new TextEncoder().encode(compiled.text).length
      )
      try {
        const result = await state.client.query(compiled.text, compiled.values, state.ctx)
        observePg(bound, 'afterSql', Date.now() - started, result.rowCount)
        return result
      } catch (cause) {
        observePg(
          bound,
          'onSqlError',
          typeof cause === 'object' && cause !== null && 'code' in cause
            ? String(cause.code)
            : undefined
        )
        throw cause
      }
    }
    const scope = getScope?.()
    return scope
      ? runPgScopeOperation(
          organization,
          scope,
          PgOperation.sql,
          () => ({}),
          (state, current) => run(state, current)
        )
      : runPgRootOperation(
          organization,
          PgOperation.sql,
          ctx,
          () => ({}),
          (state) => run(state, undefined)
        )
  }
  return {
    sql: createSqlTag({
      dialect: 'postgres',
      all: async (prepare, ctx) => (await execute(prepare, ctx)).rows,
      get: async (prepare, ctx) => (await execute(prepare, ctx)).rows[0],
      run: async (prepare, ctx) => ({ changes: (await execute(prepare, ctx)).rowCount })
    })
  }
}

/** One record cursor owns its page position while the canonical lifetime owns admission. */
class PgRecordCursor<T> {
  /** The organization retains transaction admission and native table ownership. */
  readonly #organization: IPgOrganizationContext<T>
  /** Callers may mutate their range while deferred pages are read. */
  readonly #range: IKeyRange | undefined
  /** A root cursor uses the original call context for every page. */
  readonly #ctx: IOperationContext | undefined
  /** Transaction cursors borrow the existing scope rather than opening a new transaction. */
  readonly #scope: IPgScope<T> | undefined
  /** Keyset position advances only after returning a native row. */
  #after: Uint8Array | undefined
  /** One bounded native page remains owned until consumed or closed. */
  #page: readonly { readonly key: IStorageKey; readonly bytes: Uint8Array; readonly value: T }[] =
    []
  /** Index into the current page preserves native key order. */
  #position = 0
  /** Exhaustion and explicit close both prevent another native page read. */
  #ended = false

  /** Snapshot only the deferred range; execution and scope keep their original owners. */
  constructor(
    organization: IPgOrganizationContext<T>,
    range: IKeyRange | undefined,
    ctx: IOperationContext | undefined,
    scope?: IPgScope<T>
  ) {
    this.#organization = organization
    this.#range = snapshotKeyRange(range, PgNames.backend)
    this.#ctx = ctx
    this.#scope = scope
  }

  /** Read a bounded page inside the admitted native transaction and return one decoded row. */
  async #advance(state: IPgState): Promise<IteratorResult<[IStorageKey, T]>> {
    if (this.#ended) return { done: true, value: undefined }
    if (this.#position === this.#page.length) {
      this.#page = await scanPgRecords<T>(
        state,
        this.#organization.environment.tables,
        this.#range,
        this.#after,
        128
      )
      this.#position = 0
      if (this.#page.length === 0) {
        this.#ended = true
        return { done: true, value: undefined }
      }
    }
    const row = this.#page[this.#position++]!
    this.#after = row.bytes
    return { done: false, value: [row.key, row.value] }
  }

  /** Release buffered rows without changing the canonical lifetime's terminal semantics. */
  #close(): void {
    this.#ended = true
    this.#page = []
  }

  /** Register one scoped iterator or expose one root iterator with the existing lifetime. */
  open(): IStorageIterator<[IStorageKey, T]> {
    if (this.#scope)
      return this.#organization.engine.registerIterator(this.#scope, {
        next: (current) =>
          this.#organization.runtime.execution.run(
            {
              operation: PgOperation.next,
              input: { range: this.#range },
              ctx: this.#organization.engine.stateFor(current).ctx,
              scope: current,
              internal: true
            },
            () => this.#advance(this.#organization.engine.stateFor(current))
          ),
        close: () => this.#close()
      })
    const lifetime = createStorageIteratorLifetime<[IStorageKey, T]>({
      close: async () => this.#close(),
      report: this.#organization.environment.report
    })
    return {
      next: () =>
        lifetime.advance(() =>
          runPgRootOperation(
            this.#organization,
            PgOperation.next,
            this.#ctx,
            () => this.#range,
            (state) => this.#advance(state)
          )
        ),
      return: (value) => {
        this.#close()
        return lifetime.returned(value)
      },
      dispose: lifetime.dispose,
      [asyncDisposeKey]: lifetime.symbolic,
      [Symbol.asyncIterator]() {
        return this
      }
    }
  }
}

/** Keyset pages retain bounded native buffers and keep every next in the original transaction. */
export function createPgRecordIterator<T>(
  organization: IPgOrganizationContext<T>,
  range: IKeyRange | undefined,
  ctx: IOperationContext | undefined,
  scope?: IPgScope<T>
): IStorageIterator<[IStorageKey, T]> {
  return new PgRecordCursor(organization, range, ctx, scope).open()
}

/** Shared query plans own all client predicates, projections, traversal, reductions and patching. */
export function createPgRecordSource<T>(
  organization: IPgOrganizationContext<T>,
  scope?: IPgScope<T>
): IRecordQuerySource {
  return {
    pushdown: {
      operators: [],
      operations: [],
      source: PgNames.backend,
      index: organization.environment.tables.record
    },
    asyncDisposeKey,
    tieBreakByKey: { direction: 'next' },
    cursorSource: organization.store,
    execute: (input) => createPgRecordIterator(organization, undefined, input.ctx, scope),
    mutate: (request, run) => {
      const invoke = (state: IPgState, current: IPgScope<T>) =>
        run({
          execute: (input) => createPgRecordIterator(organization, undefined, input.ctx, current),
          accept: async (key, value) => {
            if (request.operation === 'delete')
              return removePg(state, organization.environment.tables, 'record', key)
            await writePg(state, organization.environment.tables, 'record', key, value, 'conflict')
            return true
          }
        })
      return scope
        ? runPgScopeOperation(
            organization,
            scope,
            request.operation,
            () => ({}),
            (state, current) => invoke(state, current)
          )
        : organization.engine.run(
            (current) => invoke(organization.engine.stateFor(current), current),
            {
              ...request.ctx,
              ...(request.concurrency === undefined ? {} : { concurrency: request.concurrency })
            },
            request.operation
          )
    },
    ...(scope === undefined && organization.environment.configuration.server === 'postgres'
      ? {
          watch: (input) =>
            createBackendChangeIterator(organization.environment.controller, {
              orgId: organization.runtime.orgId,
              channel: 'record',
              ctx: input.ctx,
              execute: (advance, context) =>
                organization.runtime.execution.run(
                  { operation: PgOperation.watch, input: {}, ctx: context },
                  advance
                )
            })
        }
      : {})
  }
}

/** These exact targets are native standard tables; no other channel is guessed or emulated. */
export async function pgOrgDeadline<T>(
  organization: IPgOrganizationContext<T>,
  state: IPgState,
  input: ITtlTarget,
  ms?: number,
  persist = false
): Promise<number | boolean | undefined> {
  const target = pgOrgTtlTarget(organization, input)
  if (target.channel === 'vector') return organization.vectors!.deadline(state, target, ms, persist)
  const channel = target.channel
  const key = target.key
  await prunePg(state, organization.environment.tables, channel, key)
  const encoded = channel === 'record' ? pgKey(key).bytes : pgKey(key).hex
  if (ms === undefined && !persist) {
    const row = (
      await state.client.query(
        'SELECT CASE WHEN expires_at IS NULL THEN NULL ELSE GREATEST(0,extract(epoch FROM (expires_at-clock_timestamp()))*1000) END AS remaining FROM ' +
          organization.environment.tables[channel] +
          ' WHERE org_id=$1 AND key=$2',
        [organization.runtime.orgId, encoded],
        state.ctx
      )
    ).rows[0]
    return row?.remaining == null ? undefined : Number(row.remaining)
  }
  await state.guardKeys([target])
  const result = await state.client.query(
    'UPDATE ' +
      organization.environment.tables[channel] +
      ' SET expires_at=' +
      (persist ? 'NULL' : "clock_timestamp()+($3::float8*interval '1 millisecond')") +
      ' WHERE org_id=$1 AND key=$2' +
      (persist ? ' AND expires_at IS NOT NULL' : '') +
      ' RETURNING key' +
      (state.journal === undefined ? '' : ',value,expires_at::text AS deadline'),
    [organization.runtime.orgId, encoded, ...(persist ? [] : [ms!])],
    state.ctx
  )
  if (result.rowCount !== 0) markPgChanged(state, channel, key, result.rows[0])
  return result.rowCount !== 0
}
