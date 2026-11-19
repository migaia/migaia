/** Data-layer contract shapes: resource snapshots and bindings, model bodies and field protocol. */
import { isRecord } from './record.ts'
import type { IJsonSchema } from './types.ts'

/**
 * Asynchronous state of a resource entry. `idle` has not started loading; `loading` is the first
 * load without data; `ready` holds non-empty data; `empty` succeeded with an empty result; `error`
 * is the latest load failing. Transitions are executed by the part host's resource store.
 */
export const ResourceStatus = {
  idle: 'idle',
  loading: 'loading',
  ready: 'ready',
  empty: 'empty',
  error: 'error'
} as const

/** One resource status. */
export type ResourceStatus = keyof typeof ResourceStatus

/**
 * Snapshot of one resource entry handed to parts. `data` keeps the latest successful result while
 * refreshing or after an error; `refreshing` is true while a load runs over an existing result;
 * `page` is present when the resource declares paging.
 */
export type IResourceSnapshot<TData = unknown> = {
  readonly status: ResourceStatus
  readonly data?: TData
  readonly error?: { readonly code?: string; readonly message: string }
  readonly refreshing: boolean
  readonly page?: { readonly index: number; readonly size: number; readonly total?: number }
}

/**
 * Blueprint binding of a resource: the resource id and its parameters. Parameter values are
 * literals or `$state` / `$derive` / `$row` bindings. Allowed only on the prop a part names in
 * `behavior.resource.prop`.
 */
export type IResourceBinding = {
  readonly $resource: string
  readonly params?: Readonly<Record<string, unknown>>
}

/** True for a `{ $resource }` binding with a string id and an optional object of parameters. */
export function isResourceBinding(value: unknown): value is IResourceBinding {
  return (
    isRecord(value) &&
    typeof value.$resource === 'string' &&
    (value.params === undefined || isRecord(value.params))
  )
}

/** Display formats of a model field, used by generated tables, forms and filters. */
export const ModelFieldFormat = {
  text: 'text',
  number: 'number',
  money: 'money',
  date: 'date',
  datetime: 'datetime',
  enum: 'enum',
  boolean: 'boolean'
} as const

/** One model field format. */
export type ModelFieldFormat = keyof typeof ModelFieldFormat

/**
 * How a field part's change callback carries the new value: `detail` is the first callback argument
 * itself, `target-value` and `target-checked` read `event.target.value` / `.checked`.
 */
export const FieldRead = {
  detail: 'detail',
  targetValue: 'target-value',
  targetChecked: 'target-checked'
} as const

/** One field read mode. */
export type FieldRead = (typeof FieldRead)[keyof typeof FieldRead]

/** Display hints of one model field. */
export type IModelFieldDisplay = {
  readonly label?: string
  readonly format?: ModelFieldFormat
  readonly enumLabels?: Readonly<Record<string, string>>
  readonly hidden?: boolean
}

/** Relation of a model to another model through local fields. */
export type IModelRelation = {
  readonly target: string
  readonly cardinality: 'one' | 'many'
  readonly via: readonly string[]
}

/** Catalog body of a `model` descriptor. */
export type IModelBody = {
  readonly schema: IJsonSchema
  readonly key: readonly string[]
  readonly display?: Readonly<Record<string, IModelFieldDisplay>>
  readonly relations?: Readonly<Record<string, IModelRelation>>
}

/**
 * Resource behaviour group of a part: `prop` receives the snapshot; `slots` maps statuses to slot
 * names shown instead of the component while the entry is in that status.
 */
export type IResourceBehavior = {
  readonly prop: string
  readonly slots?: {
    readonly loading?: string
    readonly empty?: string
    readonly error?: string
  }
}

/** Field protocol of a part: value prop, change event and how the event carries the value. */
export type IFieldBehavior = {
  readonly value: string
  readonly change: string
  readonly read?: FieldRead
}
