import type { IPluginConstraint, IPluginHostCore } from '@migaia/plugin-host'
import type { IRpcConstructionControl } from './construction-install.js'
import type { IRpcPortFeature } from './port-feature.js'
import type { IRpcAbortSignal, IRpcHookEvent } from '../typing.js'
import type { IRpcTransport } from '../transport.js'
import { RpcPortName } from './plugin-shared-keys.js'
import type { IRpcPortValues } from './plugin-shared-keys.js'

/** Domain core copied into each PluginHost registration without exposing raw host controls. */
export type IRpcPluginCore = {
  readonly id: string
  readonly transport: IRpcTransport
  readonly signal: IRpcAbortSignal
  readonly hooks: (event: IRpcHookEvent) => void
  readonly construction: IRpcConstructionControl
  /** Reads a port from the registration-local Feature output catalog during construction. */
  readonly getPort: {
    <TKey extends keyof IRpcPortValues>(key: TKey): IRpcPortValues[TKey]
    (key: PropertyKey): unknown
  }
  /** Publishes one provider's Feature outputs into the construction catalog exactly once. */
  readonly publishPortFeatures: (outputs: Readonly<Record<string, IRpcPortFeature>>) => void
  /** Records one registration-local native middleware projection before endpoint activation. */
  readonly registerNativeMiddlewareKeys: (name: string, keys: readonly string[]) => void
}

/** Narrow resource ownership passed to a WebRPC plugin install body. */
export type IRpcPluginInstallScope = {
  readonly id: string
  readonly transport: IRpcTransport
  readonly signal: IRpcAbortSignal
  readonly hooks: (event: IRpcHookEvent) => void
  readonly getPort: (key: PropertyKey) => unknown
  own<T>(resource: T, release: () => void | Promise<void>): T
}

/** Stable first-party middleware role names admitted by the WebRPC translator. */
export const RpcFirstPartyRole = {
  hooks: 'hooks',
  ping: 'ping',
  uuid: 'uuid',
  finalize: 'middleware-finalize'
} as const

export type IRpcFirstPartyRole = (typeof RpcFirstPartyRole)[keyof typeof RpcFirstPartyRole]

/** Immutable shared-claim contract for one package-owned first-party role. */
export type IRpcFirstPartyRoleContract = {
  readonly sharedProvides: readonly PropertyKey[]
  readonly sharedConsumes: readonly PropertyKey[]
  readonly sharedOptionalConsumes: readonly PropertyKey[]
}

/** Candidate-independent role schema used by preflight tests and the future native translator. */
export const RpcFirstPartyRoleSchema: Readonly<
  Record<IRpcFirstPartyRole, IRpcFirstPartyRoleContract>
> = Object.freeze({
  hooks: Object.freeze({
    sharedProvides: Object.freeze([RpcPortName.hooks]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  ping: Object.freeze({
    sharedProvides: Object.freeze([RpcPortName.ping]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  uuid: Object.freeze({
    sharedProvides: Object.freeze([RpcPortName.uuid]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  'middleware-finalize': Object.freeze({
    sharedProvides: Object.freeze([]),
    sharedConsumes: Object.freeze([RpcPortName.connect]),
    sharedOptionalConsumes: Object.freeze([
      RpcPortName.protocol,
      RpcPortName.contract,
      RpcPortName.authentication,
      RpcPortName.timeout,
      RpcPortName.abort,
      RpcPortName.hooks,
      RpcPortName.ping,
      RpcPortName.uuid
    ])
  })
})

/** Candidate-independent control role name owned by the B12c04 contract boundary. */
export const RpcControlRole = Object.freeze({
  control: 'control'
} as const)

export type IRpcControlRole = (typeof RpcControlRole)[keyof typeof RpcControlRole]

/** Deeply frozen native control claims; this contract is declarative until B12c04 implementation. */
export type IRpcControlRoleContract = {
  readonly sharedProvides: readonly PropertyKey[]
  readonly sharedConsumes: readonly PropertyKey[]
  readonly sharedOptionalConsumes: readonly PropertyKey[]
  readonly publicKeys: readonly string[]
  readonly exposedKeys: readonly string[]
}

/** Package-owned authority from which control RED variants must derive their claims. */
export const RpcControlRoleSchema: Readonly<Record<IRpcControlRole, IRpcControlRoleContract>> =
  Object.freeze({
    control: Object.freeze({
      sharedProvides: Object.freeze([RpcPortName.candidatePing]),
      sharedConsumes: Object.freeze([
        RpcPortName.outboundOperations,
        RpcPortName.discoveryResolver,
        RpcPortName.time,
        RpcPortName.variationCoordinator
      ]),
      sharedOptionalConsumes: Object.freeze([]),
      publicKeys: Object.freeze(['ping', 'pingAll']),
      exposedKeys: Object.freeze(['ping', 'pingAll'])
    })
  })

/** Candidate-independent provider role name admitted by the B12c02 inventory. */
export const RpcProviderRole = Object.freeze({
  provider: 'provider'
} as const)

export type IRpcProviderRole = (typeof RpcProviderRole)[keyof typeof RpcProviderRole]

/** Exact provider shared/public projection and fixed installation order. */
export type IRpcProviderRoleContract = {
  readonly sharedProvides: readonly [typeof RpcPortName.providerCancellation]
  readonly sharedConsumes: readonly [
    typeof RpcPortName.outboundOperations,
    typeof RpcPortName.inboundIdentity,
    typeof RpcPortName.variationCoordinator
  ]
  readonly publicKeys: readonly ['provide']
  readonly exposedKeys: readonly ['provide']
  readonly installOrder: readonly ['outbound', 'provider']
}

/** Immutable candidate-independent provider contract used by admission and permanent RED tests. */
export const RpcProviderRoleSchema: Readonly<Record<IRpcProviderRole, IRpcProviderRoleContract>> =
  Object.freeze({
    provider: Object.freeze({
      sharedProvides: Object.freeze([RpcPortName.providerCancellation] as const),
      sharedConsumes: Object.freeze([
        RpcPortName.outboundOperations,
        RpcPortName.inboundIdentity,
        RpcPortName.variationCoordinator
      ] as const),
      publicKeys: Object.freeze(['provide'] as const),
      exposedKeys: Object.freeze(['provide'] as const),
      installOrder: Object.freeze(['outbound', 'provider'] as const)
    })
  })

/** Honest metadata for the provider-cancellation port; this is not a runtime port value. */
export type IRpcProviderCancellationPortMetadata = {
  readonly ownKeys: readonly ['abort']
  readonly propertyDescriptor: Readonly<{
    readonly enumerable: true
    readonly configurable: false
    readonly writable: false
  }>
  readonly signature: Readonly<{
    readonly kind: 'function'
    readonly parameters: readonly ['id']
    readonly returns: 'void'
  }>
}

/** Frozen candidate-independent metadata describing the callable enumerable port property. */
export const RpcProviderCancellationPortMetadata: IRpcProviderCancellationPortMetadata =
  Object.freeze({
    ownKeys: Object.freeze(['abort'] as const),
    propertyDescriptor: Object.freeze({
      enumerable: true,
      configurable: false,
      writable: false
    }),
    signature: Object.freeze({
      kind: 'function' as const,
      parameters: Object.freeze(['id'] as const),
      returns: 'void' as const
    })
  })

/** PluginHost lifecycle core combined with the WebRPC domain core by `defineHost`. */
export type IRpcPluginHostCore = IPluginHostCore<unknown>

/** Type constraint accepted by the one WebRPC PluginHost install batch. */
export type IRpcPluginConstraint = IPluginConstraint<IRpcPluginCore & IRpcPluginHostCore>
