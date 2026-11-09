import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { PluginHostPipeline } from './pipeline-entry.ts'
import { asyncMode } from '@migaia/middleware-pipeline/async'
/** Installs the real async runner identity without loading other mode implementations. */
export const asyncPipelineModule: IHostModule<typeof HostModuleKey.pipelineAsync> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.pipelineAsync,
    install(context) {
      context.pipelineModes.set(asyncMode.key, asyncMode)
      context.pipelineEntry = PluginHostPipeline
    }
  })
