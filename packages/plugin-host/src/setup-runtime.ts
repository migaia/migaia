import type { PluginHostOperationRuntime } from './operation-runtime.js'
import type { IAbortSignal } from '@migaia/utils/promise'
import type { IAbortController } from '@migaia/lifecycle/abort'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRegistration } from './registry.js'
import type { IPluginHostCore, IPluginHostDiagnostic } from './typing.js'

/** Host authority needed by setup; the registration remains owned by its install transaction. */
export type IPluginSetupPort = Readonly<{
  /** Marks only the synchronous setup invocation, leaving async continuations unmarked. */
  readonly invokeHook: <T>(invoke: () => T) => T
  readonly createCore: (registration: IRegistration<any, any>) => IPluginHostCore<any>
  readonly executionSignal: IAbortSignal
  readonly scheduler: IScheduler
  readonly setSetupPending: (registration: IRegistration<any, any> | undefined) => void
  readonly diagnostic: IPluginHostDiagnostic
  /** Setup shares the installation's generation owner instead of copying unbound methods. */
  readonly operations: Pick<PluginHostOperationRuntime, 'await' | 'assertCurrent'>
}>

/** Exact attempt lifetime retained by contexts that may outlive the registration. */
export type IPluginSetupAttempt = {
  open: boolean
  readonly controller: IAbortController
}
