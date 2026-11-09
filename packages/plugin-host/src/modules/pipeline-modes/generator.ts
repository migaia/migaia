import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { PluginHostPipeline } from './pipeline-entry.ts'
import { generatorMode } from '@migaia/middleware-pipeline/generator'
/** Installs the real generator runner identity without loading other mode implementations. */
export const generatorPipelineModule: IHostModule<typeof HostModuleKey.pipelineGenerator> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.pipelineGenerator,
    install(context) {
      context.pipelineModes.set(generatorMode.key, generatorMode)
      context.pipelineEntry = PluginHostPipeline
    }
  })
