import {
  createThreadSupervisor,
  type IThreadHandle,
  type IThreadSpec
} from '@migaia/supervision/threads'
import { defaultRpcId } from '../core/internal/id.js'
import type { IRemoteBinding } from '../remote/types.js'
import { portableThreadSpec } from './error.js'
import type { IThreadCommonOptions } from './types.js'

/** One supervisor owns Worker lifecycle; remote owns channel generations and shared retry. */
export function createThreadBinding<THandle extends IThreadHandle>(
  options: Omit<IThreadCommonOptions<THandle>, 'endpointFactory'>
): IRemoteBinding<THandle, IThreadSpec> {
  /** Admission snapshots data before constructing any lifecycle owner. */
  const spec = portableThreadSpec(options.spec)
  /** Every caller-selected policy and the exact health port stay with supervision. */
  const supervisor = createThreadSupervisor({
    ...options.supervisor,
    id: options.supervisor?.id ?? defaultRpcId(),
    launcher: options.launcher,
    spec,
    budget: options.budget,
    scheduler: options.scheduler,
    report: options.report,
    health: options.health
  })
  return {
    ownership: 'owned',
    supervisor,
    scheduler: options.scheduler,
    openChannel: (handle, signal) => options.channelFactory.open(handle, signal)
  }
}
