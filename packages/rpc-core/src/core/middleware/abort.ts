import { registerJsonObjectMiddleware } from '../internal/json-object-port.js'
import type { IRpcPlugin, IRpcPluginInstallResult } from '../typing.js'
import { RpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'
const abortPlugin: IRpcPlugin = Object.freeze({
  name: 'middleware:abort',
  metadata: Object.freeze({
    claims: Object.freeze({
      routes: [],
      provides: [],
      consumes: [],
      publicKeys: [],
      exposedKeys: [],
      activator: false
    }),
    sharedProvides: [RpcPortName.abort]
  }),
  install: (): IRpcPluginInstallResult => ({
    extension: Object.freeze({}),
    ports: Object.freeze({ [RpcPortName.abort]: Object.freeze({ enabled: true }) })
  })
})

/**
 * Enable remote abort notifications when a local request cancels or expires. Local signal
 * cancellation also works without this plugin; remote application work must observe its
 * context.signal to cooperate.
 */
export const abort = (): IRpcPlugin => registerJsonObjectMiddleware(freezePlugin(abortPlugin))
