import type { IWebRpcPlugin, IWebRpcPluginInstallResult } from '../typing.js'
import { WebRpcPortName } from '../internal/plugin-shared-keys.js'
import { freezePlugin } from '../internal/plugin-descriptor.js'
const abortPlugin: IWebRpcPlugin = Object.freeze({
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
    sharedProvides: [WebRpcPortName.abort]
  }),
  install: (): IWebRpcPluginInstallResult => ({
    extension: Object.freeze({}),
    ports: Object.freeze({ [WebRpcPortName.abort]: Object.freeze({ enabled: true }) })
  })
})

/** Creates the native abort-enable plugin used directly by the factory composer. */
export const abort = (): IWebRpcPlugin => freezePlugin(abortPlugin)
