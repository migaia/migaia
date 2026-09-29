import {
  createAbortController,
  observeAbortSubscription,
  type IAbortSignal
} from '@migaia/lifecycle/abort'
import type { IScheduler } from '@migaia/utils/scheduler'
import { resolveDisposer } from './disposal.js'
import { reportDiagnostic } from './diagnostic-report.js'
import { PluginHostErrorCode } from './error-code.js'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.js'
import { invokeCaptured } from './invocation.js'
import type { IRegistration } from './registry.js'
import type {
  IPluginHostCore,
  IPluginHostDiagnostic,
  IPluginResource,
  IPluginSetupContext
} from './typing.js'

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
  readonly controller: ReturnType<typeof createAbortController>
}

/** Reports a rejection only when it arrives after timeout or Host disposal won the attempt. */
const reportLateSettlement = (
  pending: Promise<unknown>,
  primary: unknown,
  signal: IAbortSignal,
  name: string,
  diagnostic: IPluginHostDiagnostic
): void => {
  void pending.then(undefined, (error: unknown) => {
    if (error === primary || error === signal.reason) return
    reportDiagnostic(
      diagnostic,
      ERROR_TEXT.SETUP_LATE_REJECTION(name),
      PluginHostErrorCode.pluginInstallFailed,
      error
    )
  })
}

/** Releases an orphaned resource immediately while keeping cleanup failure diagnostic only. */
const releaseLateResource = (
  resource: IPluginResource,
  name: string,
  diagnostic: IPluginHostDiagnostic
): void => {
  let disposer: ReturnType<typeof resolveDisposer>
  try {
    disposer = resolveDisposer(resource)
  } catch (cause) {
    throw createPluginHostTypeError(ERROR_TEXT.INVALID_OPTION, { cause })
  }
  if (!disposer) throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_RESOURCE_DISPOSER)
  try {
    void Promise.resolve(disposer()).catch((error) =>
      reportDiagnostic(
        diagnostic,
        ERROR_TEXT.SETUP_LATE_RELEASE_FAILED(name),
        PluginHostErrorCode.pluginDisposeFailed,
        error
      )
    )
  } catch (error) {
    reportDiagnostic(
      diagnostic,
      ERROR_TEXT.SETUP_LATE_RELEASE_FAILED(name),
      PluginHostErrorCode.pluginDisposeFailed,
      error
    )
  }
}

/** Creates the narrow setup context with a signal private to this installation attempt. */
const createSetupContext = (
  registration: IRegistration<any, any>,
  core: IPluginHostCore<any>,
  attempt: IPluginSetupAttempt,
  port: IPluginSetupPort
): IPluginSetupContext => {
  const operation = Object.freeze({
    signal: attempt.controller.signal,
    deadlineAt: registration.operationDeadlineAt,
    now: () => port.scheduler.now()
  })
  return Object.freeze({
    config: core.config,
    operation,
    get lifecycle() {
      return core.lifecycle
    },
    onDispose: (resource: IPluginResource): void => {
      if (attempt.open && registration.provisional) return core.onDispose(resource)
      releaseLateResource(resource, registration.name, port.diagnostic)
      throw new PluginHostError(
        PluginHostErrorCode.resourceOutsideInstall,
        ERROR_TEXT.RESOURCE_OUTSIDE_INSTALL
      )
    }
  })
}

/** Closes setup resource admission before rollback or after installation commits. */
export const closeSetupAttempt = (registration: IRegistration<any, any>): void => {
  if (registration.setupAttempt) registration.setupAttempt.open = false
}

/** Runs setup under the install operation and preserves timeout and disposal error identity. */
export async function runPluginSetup(
  registration: IRegistration<any, any>,
  port: IPluginSetupPort
): Promise<unknown> {
  const core = port.createCore(registration)
  const attempt: IPluginSetupAttempt = { open: true, controller: createAbortController() }
  registration.setupAttempt = attempt
  const context = createSetupContext(registration, core, attempt, port)
  const onObservationFailure = (error: unknown): void => {
    reportDiagnostic(
      port.diagnostic,
      ERROR_TEXT.INVALID_OPTION,
      PluginHostErrorCode.invalidOption,
      error
    )
  }
  const disposeSubscription = observeAbortSubscription(
    port.executionSignal,
    (reason) => attempt.controller.abort(reason),
    onObservationFailure
  )
  port.setSetupPending(registration)
  /** Subscription for the attempt's abort race, removed when setup settles. */
  let attemptSubscription: ReturnType<typeof observeAbortSubscription> | undefined
  try {
    const pending = Promise.resolve(
      invokeCaptured(registration.plugin.setup!, registration.plugin.owner, [context])
    )
    /** Identifies a rejection produced by setup itself before the deadline or disposal won. */
    let ownRejection: { readonly error: unknown } | undefined
    const tracked = pending.then(undefined, (error: unknown) => {
      ownRejection = { error }
      throw error
    })
    const abandoned = new Promise<never>((_resolve, reject) => {
      attemptSubscription = observeAbortSubscription(
        attempt.controller.signal,
        (reason) => reject(reason),
        onObservationFailure
      )
    })
    let output: unknown
    try {
      output = await port.awaitOperation(Promise.race([tracked, abandoned]), registration)
    } catch (error) {
      if (ownRejection && ownRejection.error === error) throw error
      const code = error instanceof PluginHostError ? error.code : undefined
      if (code === PluginHostErrorCode.mutationExecutionTimeout) attempt.controller.abort(error)
      if (
        code === PluginHostErrorCode.mutationExecutionTimeout ||
        code === PluginHostErrorCode.hostDisposing
      )
        reportLateSettlement(
          pending,
          error,
          attempt.controller.signal,
          registration.name,
          port.diagnostic
        )
      throw error
    }
    port.assertOperationCurrent(registration)
    return output
  } finally {
    port.setSetupPending(undefined)
    attemptSubscription?.unsubscribe()
    disposeSubscription.unsubscribe()
  }
}
