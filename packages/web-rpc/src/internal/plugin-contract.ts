import type { IPluginConstraint, IPluginHostCore } from '@migaia/plugin-host'
import type { IWebRpcConstructionControl } from './construction-install.js'
import type { IWebRpcAbortSignal, IWebRpcHookEvent } from '../typing.js'
import type { IWebRpcTransport } from '../transport.js'
import {
  WebRpcSharedKey,
  type IWebRpcAuthenticationPort,
  type IWebRpcAbortEnablePort,
  type IWebRpcChunkPort,
  type IWebRpcConnectPort,
  type IWebRpcContractPort,
  type IWebRpcDiscoveryResolverPort,
  type IWebRpcHooksPort,
  type IWebRpcInboundIdentityPort,
  type IWebRpcOutboundOperationsPort,
  type IWebRpcPingEnablePort,
  type IWebRpcProviderCancellationPort,
  type IWebRpcProtocolPort,
  type IWebRpcOutboundAttachmentPort,
  type IWebRpcSharedValues,
  type IWebRpcTimePort,
  type IWebRpcTimeoutPort,
  type IWebRpcUuidPort,
  type IWebRpcVariationCoordinatorPort
} from './plugin-shared-keys.js'

/** Domain core copied into each PluginHost registration without exposing raw host controls. */
export type IWebRpcPluginCore = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly signal: IWebRpcAbortSignal
  readonly hooks: (event: IWebRpcHookEvent) => void
  readonly construction: IWebRpcConstructionControl
}

/** Narrow resource ownership passed to a WebRPC plugin install body. */
export type IWebRpcPluginInstallScope = {
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly signal: IWebRpcAbortSignal
  readonly hooks: (event: IWebRpcHookEvent) => void
  readonly getShared: (key: PropertyKey) => unknown
  own<T>(resource: T, release: () => void | Promise<void>): T
}

/** Stable first-party middleware role names admitted by the WebRPC translator. */
export const WebRpcFirstPartyRole = {
  hooks: 'hooks',
  ping: 'ping',
  uuid: 'uuid',
  chunk: 'chunk',
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
    sharedProvides: Object.freeze([WebRpcSharedKey.hooks]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  ping: Object.freeze({
    sharedProvides: Object.freeze([WebRpcSharedKey.ping]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  uuid: Object.freeze({
    sharedProvides: Object.freeze([WebRpcSharedKey.uuid]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  chunk: Object.freeze({
    sharedProvides: Object.freeze([WebRpcSharedKey.chunk]),
    sharedConsumes: Object.freeze([]),
    sharedOptionalConsumes: Object.freeze([])
  }),
  'middleware-finalize': Object.freeze({
    sharedProvides: Object.freeze([]),
    sharedConsumes: Object.freeze([WebRpcSharedKey.connect]),
    sharedOptionalConsumes: Object.freeze([
      WebRpcSharedKey.protocol,
      WebRpcSharedKey.contract,
      WebRpcSharedKey.authentication,
      WebRpcSharedKey.timeout,
      WebRpcSharedKey.abort,
      WebRpcSharedKey.hooks,
      WebRpcSharedKey.ping,
      WebRpcSharedKey.uuid,
      WebRpcSharedKey.chunk
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
    sharedProvides: Object.freeze([WebRpcSharedKey.candidatePing]),
    sharedConsumes: Object.freeze([
      WebRpcSharedKey.outboundOperations,
      WebRpcSharedKey.discoveryResolver,
      WebRpcSharedKey.time,
      WebRpcSharedKey.variationCoordinator
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
  readonly sharedProvides: readonly [typeof WebRpcSharedKey.providerCancellation]
  readonly sharedConsumes: readonly [
    typeof WebRpcSharedKey.outboundOperations,
    typeof WebRpcSharedKey.inboundIdentity,
    typeof WebRpcSharedKey.variationCoordinator
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
    sharedProvides: Object.freeze([WebRpcSharedKey.providerCancellation] as const),
    sharedConsumes: Object.freeze([
      WebRpcSharedKey.outboundOperations,
      WebRpcSharedKey.inboundIdentity,
      WebRpcSharedKey.variationCoordinator
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

/** Host core view with concrete return types for every package-owned shared symbol. */
export type IWebRpcPluginHostCore = Omit<
  IPluginHostCore<unknown, IWebRpcSharedValues>,
  'getShared'
> & {
  getShared(key: typeof WebRpcSharedKey.protocol): IWebRpcProtocolPort | undefined
  getShared(key: typeof WebRpcSharedKey.authentication): IWebRpcAuthenticationPort | undefined
  getShared(key: typeof WebRpcSharedKey.contract): IWebRpcContractPort | undefined
  getShared(key: typeof WebRpcSharedKey.connect): IWebRpcConnectPort | undefined
  getShared(key: typeof WebRpcSharedKey.abort): IWebRpcAbortEnablePort | undefined
  getShared(key: typeof WebRpcSharedKey.ping): IWebRpcPingEnablePort | undefined
  getShared(key: typeof WebRpcSharedKey.hooks): IWebRpcHooksPort | undefined
  getShared(key: typeof WebRpcSharedKey.timeout): IWebRpcTimeoutPort | undefined
  getShared(key: typeof WebRpcSharedKey.uuid): IWebRpcUuidPort | undefined
  getShared(key: typeof WebRpcSharedKey.chunk): IWebRpcChunkPort | undefined
  getShared(key: typeof WebRpcSharedKey.inboundIdentity): IWebRpcInboundIdentityPort | undefined
  getShared(
    key: typeof WebRpcSharedKey.variationCoordinator
  ): IWebRpcVariationCoordinatorPort | undefined
  getShared(
    key: typeof WebRpcSharedKey.outboundOperations
  ): IWebRpcOutboundOperationsPort | undefined
  getShared(key: typeof WebRpcSharedKey.discoveryResolver): IWebRpcDiscoveryResolverPort | undefined
  getShared(
    key: typeof WebRpcSharedKey.providerCancellation
  ): IWebRpcProviderCancellationPort | undefined
  getShared(key: typeof WebRpcSharedKey.time): IWebRpcTimePort | undefined
  getShared(
    key: typeof WebRpcSharedKey.outboundAttachment
  ): IWebRpcOutboundAttachmentPort | undefined
  getShared(key: PropertyKey): unknown
}

/** Type constraint accepted by the one WebRPC PluginHost install batch. */
export type IWebRpcPluginConstraint = IPluginConstraint<IWebRpcPluginCore & IWebRpcPluginHostCore>
