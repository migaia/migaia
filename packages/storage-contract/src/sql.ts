import { type StorageStageKind } from './stage-kind.js'
import { type ITransactionScope } from './transaction.js'
import { type IOperationContext } from './context.js'

/** SQL observations bind to the original transaction owner and never execute statements. */
export type ISqlStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.sql
  forTransaction: (scope: Omit<ITransactionScope, 'use'>) => ISqlStageObserver
  beforeSql?: (parameterCount: number, sqlBytes: number) => void | PromiseLike<void>
  afterSql?: (elapsedMs: number, rows: number | bigint) => void | PromiseLike<void>
  onSqlError?: (code?: string) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>

/** Fragment identity is type-opaque; only the private node table grants runtime authenticity. */
declare const sqlFragmentBrand: unique symbol

/** Shared native SQL values retain booleans and bigint without promising backend-specific columns. */
export type ISqlValue = null | string | number | bigint | boolean | Uint8Array

/** Dynamic default rows share only the declared native scalar domain. */
export type ISqlRow = Readonly<Record<string, ISqlValue>>

/** Shared execution reports changes; insertion identity remains a backend-specific refinement. */
export type ISqlRunResult = { readonly changes: number | bigint }

/** Pure immutable SQL composition owns no connection or execution terminal. */
export type ISqlFragment = { readonly [sqlFragmentBrand]: true }

/** Every interpolation is either a native bound scalar or an authentic existing fragment. */
export type ISqlInput = ISqlValue | ISqlFragment

/** A bound query retains fragment identity while its original backend owns actual execution. */
export type ISqlQuery<
  TRow extends object & { readonly [K in keyof TRow]: ISqlValue } = ISqlRow,
  TResult extends ISqlRunResult = ISqlRunResult
> = ISqlFragment & {
  all(ctx?: IOperationContext): Promise<readonly TRow[]>
  get(ctx?: IOperationContext): Promise<TRow | undefined>
  run(ctx?: IOperationContext): Promise<TResult>
}

/** Row and result parameters preserve each backend's native domain without erasing shared inputs. */
export type ISqlTag<
  TValue extends ISqlValue = ISqlValue,
  TResult extends ISqlRunResult = ISqlRunResult
> = {
  <TRow extends object & { readonly [K in keyof TRow]: TValue } = Readonly<Record<string, TValue>>>(
    strings: TemplateStringsArray,
    ...values: readonly ISqlInput[]
  ): ISqlQuery<TRow, TResult>
  id(...parts: readonly [string, ...string[]]): ISqlFragment
  join(fragments: readonly ISqlFragment[], separator?: ISqlFragment): ISqlFragment
  readonly empty: ISqlFragment
}

/** An execution-local pure projection contains no connection, cursor or disposal authority. */
export type ICompiledStorageSql = {
  readonly text: string
  readonly values: readonly ISqlValue[]
}

/** The only common executor shape; drivers, connections and cleanup remain with backend owners. */
export type ISqlExecutor<
  TValue extends ISqlValue = ISqlValue,
  TResult extends ISqlRunResult = ISqlRunResult
> = { readonly sql: ISqlTag<TValue, TResult> }

/** Stable native SQL endpoints are shared by finite transaction projections and their owner. */
export const SqlQueryMethod = { all: 'all', get: 'get', run: 'run' } as const

/** Read-only terminal replacement keeps the exact original fragment node and native result shape. */
export type IStorageSqlQueryTerminals<TRow extends object, TResult extends ISqlRunResult> = {
  all(ctx?: IOperationContext): Promise<readonly TRow[]>
  get(ctx?: IOperationContext): Promise<TRow | undefined>
  run(ctx?: IOperationContext): Promise<TResult>
}
