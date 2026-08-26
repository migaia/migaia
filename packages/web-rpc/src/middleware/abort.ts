import type { IWebRpcPlugin, IWebRpcPluginInstallResult } from '../typing.js'
import { WebRpcSharedKey } from '../internal/plugin-shared-keys.js'
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
    sharedProvides: [WebRpcSharedKey.abort]
  }),
  install: (): IWebRpcPluginInstallResult => ({
    extension: Object.freeze({}),
    shared: Object.freeze({ [WebRpcSharedKey.abort]: Object.freeze({ enabled: true }) })
  })
})

/** Creates the native abort-enable plugin used directly by the factory composer. */
export const abort = (): IWebRpcPlugin => freezePlugin(abortPlugin)
