import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import {
  PluginHostEnablementRuntime,
  createPluginHostEnablementFacade
} from './enablement-runtime.ts'
/** Optional availability operations keep native restore tokens and existing registration state. */
export const enablementModule: IHostModule<typeof HostModuleKey.enablement> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.enablement,
    install(context, port) {
      const runtime = new PluginHostEnablementRuntime(port)
      context.enablementRuntime = runtime
      context.plugin = createPluginHostEnablementFacade(runtime, port)
    }
  })
