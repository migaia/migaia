import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { PluginHostPipeline } from './pipeline-entry.ts'
import { syncMode } from '@migaia/middleware-pipeline/sync'
/** Installs the real sync runner identity without loading other mode implementations. */
export const syncPipelineModule: IHostModule<typeof HostModuleKey.pipelineSync> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.pipelineSync,
    install(context) {
      context.pipelineModes.set(syncMode.key, syncMode)
      context.pipelineEntry = PluginHostPipeline
    }
  })
