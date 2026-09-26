import type { IPluginConstraint, IPluginHostCore } from '@migaia/plugin-host'
import type { IWebRpcConstructionControl } from './construction-install.js'
import type { IWebRpcPortFeature } from './port-feature.js'
import type { IWebRpcAbortSignal, IWebRpcHookEvent } from '../typing.js'
import type { IWebRpcTransport } from '../transport.js'
import { WebRpcPortName } from './plugin-shared-keys.js'
import type { IWebRpcPortValues } from './plugin-shared-keys.js'

/** Domain core copied into each PluginHost registration without exposing raw host controls. */
export type IWebRpcPluginCore = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly signal: IWebRpcAbortSignal
  readonly hooks: (event: IWebRpcHookEvent) => void
  readonly construction: IWebRpcConstructionControl
  /** Reads a port from the registration-local Feature output catalog during construction. */
  readonly getPort: {
    <TKey extends keyof IWebRpcPortValues>(key: TKey): IWebRpcPortValues[TKey]
    (key: PropertyKey): unknown
  }
  /** Publishes one provider's Feature outputs into the construction catalog exactly once. */
  readonly publishPortFeatures: (outputs: Readonly<Record<string, IWebRpcPortFeature>>) => void
  /** Records one registration-local native middleware projection before endpoint activation. */
  readonly registerNativeMiddlewareKeys: (name: string, keys: readonly string[]) => void
}

/** Narrow resource ownership passed to a WebRPC plugin install body. */
export type IWebRpcPluginInstallScope = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly signal: IWebRpcAbortSignal
  readonly hooks: (event: IWebRpcHookEvent) => void
  readonly getPort: (key: PropertyKey) => unknown
  own<T>(resource: T, release: () => void | Promise<void>): T
}

/** Stable first-party middleware role names admitted by the WebRPC translator. */
export const WebRpcFirstPartyRole = {
  hooks: 'hooks',
  ping: 'ping',
  uuid: 'uuid',
  finalize: 'middleware-finalize'
} as const

export type IWebRpcFirstPartyRole = (typeof WebRpcFirstPartyRole)[keyof typeof WebRpcFirstPartyRole]

/** Immutable shared-claim contract for one package-owned first-party role. */
export type IWebRpcFirstPartyRoleContract = {
  readonly sharedProvides: readonly PropertyKey[]
  readonly sharedConsumes: readonly PropertyKey[]
  readonly sharedOptionalConsumes: readonly PropertyKey[]
}

/** Candidate-independent role schema used by preflight tests and the future native translator. */
export const WebRpcFirstPartyRoleSchema: Readonly<
  Record<IWebRpcFirstPartyRole, IWebRpcFirstPartyRoleContract>
> = Object.freeze({
  hooks: Object.freeze({
    sharedProvides: Object.freeze([WebRpcPortName.hooks]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  ping: Object.freeze({
    sharedProvides: Object.freeze([WebRpcPortName.ping]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  uuid: Object.freeze({
    sharedProvides: Object.freeze([WebRpcPortName.uuid]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  'middleware-finalize': Object.freeze({
    sharedProvides: Object.freeze([]),
    sharedConsumes: Object.freeze([WebRpcPortName.connect]),
    sharedOptionalConsumes: Object.freeze([
      WebRpcPortName.protocol,
      WebRpcPortName.contract,
      WebRpcPortName.authentication,
      WebRpcPortName.timeout,
      WebRpcPortName.abort,
      WebRpcPortName.hooks,
      WebRpcPortName.ping,
      WebRpcPortName.uuid
    ])
  })
})

/** Candidate-independent control role name owned by the B12c04 contract boundary. */
export const WebRpcControlRole = Object.freeze({
  control: 'control'
} as const)

export type IWebRpcControlRole = (typeof WebRpcControlRole)[keyof typeof WebRpcControlRole]

/** Deeply frozen native control claims; this contract is declarative until B12c04 implementation. */
export type IWebRpcControlRoleContract = {
  readonly sharedProvides: readonly PropertyKey[]
  readonly sharedConsumes: readonly PropertyKey[]
  readonly sharedOptionalConsumes: readonly PropertyKey[]
  readonly publicKeys: readonly string[]
  readonly exposedKeys: readonly string[]
}

/** Package-owned authority from which control RED variants must derive their claims. */
export const WebRpcControlRoleSchema: Readonly<
  Record<IWebRpcControlRole, IWebRpcControlRoleContract>
> = Object.freeze({
  control: Object.freeze({
    sharedProvides: Object.freeze([WebRpcPortName.candidatePing]),
    sharedConsumes: Object.freeze([
      WebRpcPortName.outboundOperations,
      WebRpcPortName.discoveryResolver,
      WebRpcPortName.time,
      WebRpcPortName.variationCoordinator
    ]),
    sharedOptionalConsumes: Object.freeze([]),
    publicKeys: Object.freeze(['ping', 'pingAll']),
    exposedKeys: Object.freeze(['ping', 'pingAll'])
  })
})

/** Candidate-independent provider role name admitted by the B12c02 inventory. */
export const WebRpcProviderRole = Object.freeze({
  provider: 'provider'
} as const)

export type IWebRpcProviderRole = (typeof WebRpcProviderRole)[keyof typeof WebRpcProviderRole]

/** Exact provider shared/public projection and fixed installation order. */
export type IWebRpcProviderRoleContract = {
  readonly sharedProvides: readonly [typeof WebRpcPortName.providerCancellation]
  readonly sharedConsumes: readonly [
    typeof WebRpcPortName.outboundOperations,
    typeof WebRpcPortName.inboundIdentity,
    typeof WebRpcPortName.variationCoordinator
  ]
  readonly publicKeys: readonly ['provide']
  readonly exposedKeys: readonly ['provide']
  readonly installOrder: readonly ['outbound', 'provider']
}

/** Immutable candidate-independent provider contract used by admission and permanent RED tests. */
export const WebRpcProviderRoleSchema: Readonly<
  Record<IWebRpcProviderRole, IWebRpcProviderRoleContract>
> = Object.freeze({
  provider: Object.freeze({
    sharedProvides: Object.freeze([WebRpcPortName.providerCancellation] as const),
    sharedConsumes: Object.freeze([
      WebRpcPortName.outboundOperations,
      WebRpcPortName.inboundIdentity,
      WebRpcPortName.variationCoordinator
    ] as const),
    publicKeys: Object.freeze(['provide'] as const),
    exposedKeys: Object.freeze(['provide'] as const),
    installOrder: Object.freeze(['outbound', 'provider'] as const)
  })
})

/** Honest metadata for the provider-cancellation port; this is not a runtime port value. */
export type IWebRpcProviderCancellationPortMetadata = {
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
export const WebRpcProviderCancellationPortMetadata: IWebRpcProviderCancellationPortMetadata =
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
export type IWebRpcPluginHostCore = IPluginHostCore<unknown>

/** Type constraint accepted by the one WebRPC PluginHost install batch. */
export type IWebRpcPluginConstraint = IPluginConstraint<IWebRpcPluginCore & IWebRpcPluginHostCore>
