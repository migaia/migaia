import type { IRpcPlugin } from '../typing.js'
import type { IRpcProbe } from './types.js'
import {
  bindInstalledProbe,
  createProbeEmitter,
  validateProbes
} from '../internal/probe-emitter.js'
import { RpcPortName, type IRpcTimePort } from '../internal/plugin-shared-keys.js'
import { registerJsonObjectMiddleware } from '../internal/json-object-port.js'

/**
 * Installs one endpoint-owned emitter; configuration is validated before construction acquires
 * resources.
 */
export function probePlugin(...probes: readonly IRpcProbe[]): IRpcPlugin {
  validateProbes(probes)
  return registerJsonObjectMiddleware(
    Object.freeze({
      name: RpcPortName.probe,
      metadata: {
        claims: {
          routes: [],
          provides: [],
          consumes: [],
          publicKeys: [],
          exposedKeys: [],
          activator: false
        },
        sharedProvides: [RpcPortName.probe],
        sharedConsumes: [RpcPortName.time]
      },
      install: (scope) => {
        /** The existing kernel clock is read once; probe installation owns no timers. */
        const time = scope.getPort(RpcPortName.time) as IRpcTimePort
        /** One emitter belongs to this endpoint and is released by its construction scope. */
        const emitter = createProbeEmitter(probes, time.now, scope.id)
        scope.own(emitter, bindInstalledProbe(scope.transport, emitter))
        return { extension: {}, ports: { [RpcPortName.probe]: emitter } }
      }
    } satisfies IRpcPlugin)
  )
}
