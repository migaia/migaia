import type { IAbortSignal, IAbortController } from '@migaia/lifecycle/abort'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRegistration } from './registry.js'
import type { IPluginHostCore, IPluginHostDiagnostic } from './typing.js'

/** Host authority needed by setup; the registration remains owned by its install transaction. */
export type IPluginSetupPort = Readonly<{
  readonly createCore: (registration: IRegistration<any, any>) => IPluginHostCore<any>
  readonly executionSignal: IAbortSignal
  readonly scheduler: IScheduler
  readonly setSetupPending: (registration: IRegistration<any, any> | undefined) => void
  readonly awaitOperation: <T>(
    result: T | PromiseLike<T>,
    registration: IRegistration<any, any>
  ) => Promise<T>
  readonly assertOperationCurrent: (registration: IRegistration<any, any>) => void
  readonly diagnostic: IPluginHostDiagnostic
}>

/** Exact attempt lifetime retained by contexts that may outlive the registration. */
export type IPluginSetupAttempt = {
  open: boolean
  readonly controller: IAbortController
}
