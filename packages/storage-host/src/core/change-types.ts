import type { IBackendKind, IStorageChange } from '@migaia/storage-contract'
import type { INativeAbortSignal } from '@migaia/utils/promise'

/** Construction-time references and options retained by the backend authoring boundary. */
export type IBackendChangeSnapshot = {
  readonly backend: IBackendKind
  readonly platform: object | undefined
  readonly options: object | undefined
}

/** Original lifecycle and commit-after event owner, shared by admitted backend instances. */
export type IBackendChangeController = {
  readonly snapshot: IBackendChangeSnapshot
  readonly origin: string
  readonly closingSignal: INativeAbortSignal
  assertLive(): void
  beginMutation(): () => void
  publish(change: Omit<IStorageChange, 'sequence' | 'origin' | 'scope'>): IStorageChange | undefined
  publishExternal(change: IStorageChange): void
  subscribe(listener: (change: IStorageChange) => void): () => void
  dispose(): Promise<void>
}

export type IBackendChangeControllerOptions = {
  readonly backend: IBackendKind
  readonly platform?: object
  readonly options?: object
  /**
   * Optional backend-owned origin; cross-realm transports must not derive identity from a local
   * counter.
   */
  readonly origin?: string
  /** Concrete backend cleanup run after admitted mutations drain and before terminal state. */
  readonly finalize?: () => void | Promise<void>
}

/** Minimal physical lifecycle without event channel or iterator allocation. */
export type IBackendLifecycleController = Pick<
  IBackendChangeController,
  'snapshot' | 'origin' | 'closingSignal' | 'assertLive' | 'beginMutation' | 'dispose'
>

/** Explicit backend-selected event construction; importing a backend alone does not select it. */
export type IBackendChangeControllerFactory = (
  options: IBackendChangeControllerOptions
) => IBackendChangeController
