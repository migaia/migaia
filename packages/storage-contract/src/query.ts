import type { StorageStageKind } from './stage-kind.js'
/** Query observations carry plans and counts while the original owner retains execution. */
export type IQueryStageObserver = Readonly<{
  readonly kind: typeof StorageStageKind.query
  forTransaction: (scope: object) => IQueryStageObserver
  beforeQuery?: (
    entity: string,
    index: string | undefined,
    plan: Readonly<{ hasWhere: boolean; hasOrder: boolean; hasLimit: boolean }>
  ) => void | PromiseLike<void>
  afterQuery?: (
    entity: string,
    index: string | undefined,
    stats: Readonly<{
      readCount: number
      returnedCount: number
      elapsedMs: number
      completed: boolean
    }>
  ) => void | PromiseLike<void>
  onQueryError?: (
    entity: string,
    index: string | undefined,
    code?: string
  ) => void | PromiseLike<void>
  report: (error: unknown) => undefined
}>
