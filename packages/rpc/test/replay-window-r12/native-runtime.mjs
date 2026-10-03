import { createComposedEndpoint } from '../../dist/core/composed.js'
import { createFirstPartyRoots } from '../../dist/core/internal/first-party-roots.js'
import { createStreamFeature } from '../../dist/core/features/stream.js'
import { codec } from '../../dist/core/middleware/codec.js'
import { framer } from '../../dist/core/middleware/framer.js'
import { connect } from '../../dist/core/middleware/connect.js'
import { hooks } from '../../dist/core/middleware/hooks.js'
import { abort } from '../../dist/core/middleware/abort.js'
import { readEndpointDebugSnapshot } from '../../dist/core/internal/test-observer.js'
import { nativeReplayReceipt } from '../../dist/core/internal/native-replay.js'
import { defineRpcFeature } from '../../dist/core/internal/define-rpc-feature.js'

/**
 * Builds the production owner graph on a real negotiated native channel.
 *
 * @param {import('../../dist/remote/types.js').IRemoteChannel} channel Physical channel owner.
 * @param {string} id Local RPC identity.
 * @param {object} [options] Existing endpoint configuration overrides.
 * @returns {Promise<object>} Endpoint plus private observation readers; no public proof is
 *   fabricated.
 * @throws {Error} Original endpoint construction failure.
 */
export async function nativeEndpoint(channel, id, options = {}) {
  /** Diagnostics remain fixture callbacks and never enter public endpoint configuration. */
  const { onFailure, collectDiagnostics = true, ...configuration } = options
  /** One canonical graph shares outbound, provider, control and stream owners. */
  const roots = createFirstPartyRoots(new Set(['first-party-provider', 'first-party-one-way']))
  /** A passive fixture root reads the existing outbound installation, publishing no new member. */
  let outboundSnapshot
  const observer = defineRpcFeature(
    {
      publicKeys: [],
      claims: {
        routes: [],
        provides: [],
        consumes: [],
        publicKeys: [],
        exposedKeys: [],
        activator: false
      }
    },
    (_core, dependencies) => ({
      prepare(scope) {
        const installation = dependencies.outbound.prepare(scope)
        outboundSnapshot = () => readEndpointDebugSnapshot(installation.public)
        return Object.freeze({ public: Object.freeze({}) })
      }
    }),
    { outbound: roots['first-party-outbound'] }
  )
  /** Existing rejection/report channels retain complete objects instead of code-only counters. */
  const rejections = []
  /** Failure hooks are passive observations and do not change transport or provider behavior. */
  const failures = []
  /** Default production limits are retained; measurements must not enlarge the replay budget. */
  const endpoint = await createComposedEndpoint(
    {
      ...configuration,
      id,
      transport: channel.transport,
      scheduler: options.scheduler ?? channel.scheduler,
      providerLimits: {
        ...options.providerLimits,
        onRejected: (value) => {
          if (collectDiagnostics) rejections.push(value)
          options.providerLimits?.onRejected?.(value)
        }
      },
      middlewares: [
        codec(channel.pipeline.codec),
        framer(channel.pipeline.framer),
        abort(),
        connect({ transport: channel.transport }),
        hooks({
          listeners: [
            (event) => {
              if (event.name === 'failure') {
                if (collectDiagnostics) failures.push(event)
                onFailure?.(event)
              }
            }
          ]
        }),
        ...(options.middlewares ?? [])
      ]
    },
    {
      ...roots,
      'first-party-fixture-outbound-observer': observer,
      'first-party-stream': createStreamFeature(
        roots['first-party-outbound'],
        roots['first-party-provider']
      ),
      ...Object.fromEntries(
        channel.features.map((value, index) => [`native-channel-${index}`, value])
      )
    }
  )
  return {
    endpoint,
    failures,
    rejections,
    snapshot: () => readEndpointDebugSnapshot(endpoint),
    outboundSnapshot: () => outboundSnapshot?.(),
    receipt: nativeReplayReceipt(channel.transport)
  }
}
