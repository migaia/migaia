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

/** Creates the native abort-enable plugin used directly by the factory composer. */
export const abort = (): IRpcPlugin => freezePlugin(abortPlugin)
