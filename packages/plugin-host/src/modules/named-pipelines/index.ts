import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { PluginHostPipelines } from './named-pipelines.ts'
/** Named declarations extend the same default lane owner and native registration cleanup. */
export const namedPipelinesModule: IHostModule<typeof HostModuleKey.namedPipelines> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.namedPipelines,
    install(context) {
      context.createPipelines = (port, options) =>
        new PluginHostPipelines(port, options.pipeline, options.pipelines, context)
    }
  })
