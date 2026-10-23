import type { StorageStageKind } from './stage-kind.js'
import type { ITransactionScope } from './transaction.js'
/** SQL observations bind to the original transaction owner and never execute statements. */
export type ISqlStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.sql
  forTransaction: (scope: Omit<ITransactionScope, 'use'>) => ISqlStageObserver
  beforeSql?: (parameterCount: number, sqlBytes: number) => void | PromiseLike<void>
  afterSql?: (elapsedMs: number, rows: number | bigint) => void | PromiseLike<void>
  onSqlError?: (code?: string) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>
