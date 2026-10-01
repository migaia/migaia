import type { IThreadHandle } from '@migaia/supervision/threads'
import { createRemotePlugin, type IRemotePluginDefinition } from '../remote/plugin.js'
import { createThreadBinding } from './binding.js'
import type { IThreadPluginOptions } from './types.js'

/** Combine one owned supervisor with remote's single Plugin assembly and retry owner. */
export function createThreadPlugin<THandle extends IThreadHandle>(
  options: IThreadPluginOptions<THandle>
): IRemotePluginDefinition {
  return createRemotePlugin({
    name: options.name,
    contract: options.contract,
    host: options.host,
    binding: createThreadBinding(options),
    endpointFactory: options.endpointFactory,
    report: options.report,
    keyFactory: options.keyFactory,
    callDeadlineCapMs: options.spec.limits?.callWallTimeMs,
    ...(options.retryPort === undefined ? {} : { retryPort: options.retryPort })
  })
}
