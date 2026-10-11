import {
  createRuntimeProviderGovernor,
  type IRuntimeProviderGovernor
} from '@migaia/rpc-core/adapter'
import type { IRpcProviderLimits } from '@migaia/rpc-core'
import type { IRemoteChannel, IRemoteServeEndpoint } from '@migaia/rpc-core/remote'
import type { IScheduler } from '@migaia/utils/scheduler'
import type { IRequiredProcessResilienceOptions } from './session.js'
import { ERROR_SOURCE, RpcProcessErrorCode } from '../error-code.js'
import { RpcProcessErrorText } from '../error-text.js'

/** Process owns policy selection; Core constructs the actual quota/provider resource. */
export type IProcessProviderAdmission = Readonly<{
  core: IRuntimeProviderGovernor
  limits(limits: IRpcProviderLimits, configured?: IRpcProviderLimits): IRpcProviderLimits
  wrap(endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
  close(): void
}>

/** Reuse Core's canonical admission owner without supplying provider/bulk/preflight claims. */
export function createProcessProviderAdmission(
  channel: IRemoteChannel,
  options: IRequiredProcessResilienceOptions,
  _scheduler: IScheduler,
  closeSession: () => Promise<void>,
  report: (error: unknown) => void
): IProcessProviderAdmission {
  /** The original Process policy selects finite values and owned error diagnostics only. */
  const governor = createRuntimeProviderGovernor(
    channel,
    {
      maxCallsPerMinute: options.maxCallsPerMinute,
      maxPayloadBytes: options.maxPayloadBytes,
      maxConsecutiveTimeouts: options.maxConsecutiveTimeouts,
      idleTimeoutMs: options.idleTimeoutMs,
      violationLimit: 2,
      overflow: {
        source: ERROR_SOURCE,
        code: RpcProcessErrorCode.connectionLimit,
        message: RpcProcessErrorText.connectionLimit
      }
    },
    closeSession,
    report
  )
  return Object.freeze({
    core: governor,
    limits: governor.limits,
    wrap: governor.endpoint,
    close: governor.close
  })
}
