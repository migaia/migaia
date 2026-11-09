import type { IHostModule } from '../../module-runtime.ts'
import { defineModule } from '../../module-runtime.ts'
import { HostModuleKey } from '../../module-constants.ts'
import { PluginHostActivationOperations } from './activation-operations.ts'
/** Lazy activation owns its pending map only when explicitly installed. */
export const activationModule: IHostModule<typeof HostModuleKey.activation> =
  /* @__PURE__ */ defineModule({
    key: HostModuleKey.activation,
    install(context, port) {
      context.activationRequests = new Map()
      context.activationOperations = new PluginHostActivationOperations(context, port)
    }
  })
