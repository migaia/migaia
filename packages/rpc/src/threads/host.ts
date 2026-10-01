import type { IThreadHandle } from '@migaia/supervision/threads'
import { createRemoteHost, type IRemoteHostHandle } from '../remote/host.js'
import { createThreadBinding } from './binding.js'
import type { IThreadHostOptions } from './types.js'

/** Combine one owned supervisor with remote Host catalog and shared request recovery. */
export function createThreadHost<THandle extends IThreadHandle>(
  options: IThreadHostOptions<THandle>
): IRemoteHostHandle {
  return createRemoteHost({
    catalog: options.catalog,
    binding: createThreadBinding(options),
    endpointFactory: options.endpointFactory,
    report: options.report,
    keyFactory: options.keyFactory,
    callDeadlineCapMs: options.spec.limits?.callWallTimeMs,
    ...(options.retryPort === undefined ? {} : { retryPort: options.retryPort })
  })
}
