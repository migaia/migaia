import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { PluginHostPipeline } from './pipeline-entry.ts'
import { asyncGeneratorMode } from '@migaia/middleware-pipeline/async-generator'
/** Installs the real async-generator runner identity without loading other mode implementations. */
export const asyncGeneratorPipelineModule: IHostModule<
  typeof HostModuleKey.pipelineAsyncGenerator
> = /* @__PURE__ */ defineModule({
  key: HostModuleKey.pipelineAsyncGenerator,
  install(context) {
    context.pipelineModes.set(asyncGeneratorMode.key, asyncGeneratorMode)
    context.pipelineEntry = PluginHostPipeline
  }
})
