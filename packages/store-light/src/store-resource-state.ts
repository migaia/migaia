import type { IVersionToken } from './store-resource-ownership.ts'
import { StoreResourceKind } from './resource-state-constants.ts'

export type IResourceVersion<T> = {
  readonly id: number
  readonly token: IVersionToken
  readonly value: T
}

export type IResourceCoreState<T> =
  | { readonly kind: typeof StoreResourceKind.idle }
  | {
      readonly kind: typeof StoreResourceKind.loading
      readonly operation: Promise<T>
      readonly previous?: IResourceVersion<T>
    }
  | { readonly kind: typeof StoreResourceKind.ready; readonly current: IResourceVersion<T> }
  | {
      readonly kind: typeof StoreResourceKind.failed
      readonly error: unknown
      readonly previous?: IResourceVersion<T>
    }
  | { readonly kind: typeof StoreResourceKind.closing; readonly current?: IResourceVersion<T> }
  | { readonly kind: typeof StoreResourceKind.disposed }
