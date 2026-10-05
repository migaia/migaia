import { createRemoteBindingDrain } from '../remote/internal/binding-drain.js'
import {
  createThreadSupervisor,
  type IThreadHandle,
  type IThreadSpec
} from '@migaia/supervision/threads'
import { defaultRpcId } from '../core/internal/id.js'
import type { IRemoteBinding, IRemoteChannel, IRemoteServeEndpoint } from '../remote/types.js'
import { portableThreadSpec } from './error.js'
import type { IThreadCommonOptions } from './types.js'

/** One supervisor owns Worker lifecycle; remote owns channel generations and shared retry. */
export function createThreadBinding<THandle extends IThreadHandle>(
  options: Omit<IThreadCommonOptions<THandle>, 'endpointFactory'>
): IRemoteBinding<THandle, IThreadSpec> &
  Readonly<{
    bindEndpoint(channel: IRemoteChannel, endpoint: IRemoteServeEndpoint): IRemoteServeEndpoint
  }> {
  /** Admission snapshots data before constructing any lifecycle owner. */
  const spec = portableThreadSpec(options.spec)
  /** Native shutdown and business drain share the original remote endpoint owner. */
  const drain = createRemoteBindingDrain(options.scheduler, options.report)
  /** Every caller-selected policy and the exact health port stay with supervision. */
  const supervisor = createThreadSupervisor({
    ...options.supervisor,
    id: options.supervisor?.id ?? defaultRpcId(),
    launcher: options.launcher,
    spec,
    budget: options.budget,
    scheduler: options.scheduler,
    report: options.report,
    health: options.health,
    stop: {
      ...options.supervisor?.stop,
      beforeTerminate: async (unit, signal, remainingMs) => {
        await drain.drainCurrent({ drainMs: remainingMs() })
        if (!signal.aborted)
          await options.supervisor?.stop?.beforeTerminate?.(unit, signal, remainingMs)
      }
    }
  })
  return {
    ownership: 'owned',
    bindEndpoint: drain.wrap,
    supervisor,
    scheduler: options.scheduler,
    openChannel: (handle, signal) => options.channelFactory.open(handle, signal)
  }
}
