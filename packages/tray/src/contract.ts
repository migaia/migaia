import type {
  IGraphNodeState,
  IGraphReleaseContext,
  IGraphReadinessSnapshot,
  IAbortSignal,
  IReleaseDescriptor
} from './types.js'
import type { ICapabilityGraphState } from '@migaia/capability/graph'

export type ITrayKey = string & { readonly __trayKey: unique symbol }
export type ITrayEntryKind = 'value' | 'computed' | 'resource' | 'service'
export type ITrayEntryInstance<T> = {
  readonly value: T
  readonly release: (context: IGraphReleaseContext) => void | PromiseLike<void>
}
export type ITrayEntryContext = {
  readonly signal: IAbortSignal
  get<T>(key: ITrayKey): T
  own<T>(resource: T, descriptor: IReleaseDescriptor): T
}
export type ITrayEntryDefinition<T> = {
  readonly key: ITrayKey
  readonly kind: ITrayEntryKind
  readonly requires?: readonly ITrayKey[]
  readonly readiness?: IGraphReadinessSnapshot
  readonly start: (
    context: ITrayEntryContext
  ) => ITrayEntryInstance<T> | PromiseLike<ITrayEntryInstance<T>>
}
export type ITrayState = 'open' | ICapabilityGraphState
export type ITray = {
  readonly keys: readonly ITrayKey[]
  readonly state: ITrayState
  readonly error: unknown | undefined
  ready(): Promise<void>
  get<T>(key: ITrayKey): T
  entryState(key: ITrayKey): IGraphNodeState
  dispose(): Promise<void>
}
