import type { IObjectPathInput, IObjectPathTuple, IObjectPathValue } from './object-path.js'

export type {
  IObjectPath,
  IObjectPathInput,
  IObjectPathSegment,
  IObjectPathTuple,
  IObjectPathTupleFor,
  IObjectPathValue,
  IObjectPathWriteValue
} from './object-path.js'
export type { IProbePropertyResult } from './object.js'
export type { IAbortSignal, IDeferred } from './promise.js'

/** Groups a discriminated union by one top-level property-key field. */
export type IDiscriminatedByField<F extends PropertyKey, T extends Record<F, PropertyKey>> = {
  [K in T[F]]: Extract<T, Record<F, K>>
}

/** Selects union members whose path resolves exactly to one discriminator key. */
type IExtractDiscriminatedByPath<
  T,
  P extends string | IObjectPathTuple,
  K extends PropertyKey
> = T extends unknown
  ? P extends IObjectPathInput<T>
    ? [IObjectPathValue<T, P>] extends [K]
      ? T
      : never
    : never
  : never

/** Groups a discriminated union by a typed string or tuple object path. */
export type IDiscriminatedByPath<T, P extends IObjectPathInput<T>> = {
  [K in Extract<IObjectPathValue<T, P>, PropertyKey>]: IExtractDiscriminatedByPath<T, P, K>
}
