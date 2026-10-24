/** Original kernel declaration assertions remain independent of the final public Host contract. */
import { createComposedEndpoint } from '../../../../../rpc-host/dist/core/composed.js'
import { connect } from '../../../../../rpc-host/dist/core/middleware/connect.js'
import { codec } from '../../../../../rpc-host/dist/core/middleware/codec.js'
import { defineFeature } from '../../../../../rpc-host/dist/core/feature.js'
import { defineMiddleware } from '../../../../../rpc-host/dist/core/middleware.js'
import { framer } from '../../../../../rpc-host/dist/core/middleware/framer.js'
import type { IRpcFeature } from '../../../../../rpc-host/dist/core/feature.js'
import type { IRpcPlugin } from '../../../../../rpc-host/dist/core/typing.js'
import { createCanonicalChunkFeature } from '../../../../../rpc-host/dist/core/features/canonical-chunk.js'
import { createOutboundFeature } from '../../../../../rpc-host/dist/core/features/outbound.js'
import { createProviderFeature } from '../../../../../rpc-host/dist/core/internal/provider-feature.js'
import { buildCapabilityTopology, type ITopologyNode } from '@migaia/capability/graph/topology'
import { normalizeRpcEnvelope as normalizeV1Envelope, rpcProtocol } from '@migaia/rpc-contract/v1'
import { messageFramer } from '@migaia/rpc-contract/framing/v1'
import { createBinaryFramer, createStringFramer } from '@migaia/rpc-contract/framing'
import { encodeRpcStreamFrame } from '@migaia/rpc-contract/framing/stream'
import { createProcessTransport } from '../../../../../rpc-plugin-process/dist/process/handshake.js'
import type {
  IProcessByteChannel,
  IProcessByteOptions
} from '../../../../../rpc-plugin-process/dist/process/types.js'
import type { IRpcEnvelope, IRpcFramer, IRpcStringFrame } from '@migaia/rpc-contract'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import type { ICodec } from '@migaia/serialize/codec'
import type { IRpcTransport } from '../../../../../rpc-host/dist/core/transport.js'

declare const semantic: IRpcTransport<IRpcEnvelope>
declare const opaque: IRpcTransport<unknown>
declare const text: IRpcTransport<string>
declare const textFrames: IRpcTransport<string | IRpcStringFrame>
declare const customStringFramer: IRpcFramer<string, string, 'custom', 1>
declare const processByteChannel: IProcessByteChannel
declare const processByteOptions: IProcessByteOptions
declare const stagedInboundMismatch: Omit<IRpcTransport<string | IRpcStringFrame>, 'subscribe'> & {
  readonly subscribe: (listener: (message: { readonly data: Uint8Array }) => void) => () => void
}

/** Provides the smallest configuration accepted by packed type consumers. */
function config(id: string) {
  return { id, transport: undefined as never, middlewares: [connect()] as const }
}

async function verifyPackedContracts(): Promise<void> {
  const encodedProcessFrame: Uint8Array = encodeRpcStreamFrame(new Uint8Array([1]))
  void encodedProcessFrame
  const processChannel = await createProcessTransport(processByteChannel, processByteOptions)
  void processChannel.pipeline.codec
  const literal: { readonly packed: true } = identityCodec.encode({ packed: true } as const)
  const decoded: { readonly packed: true } = identityCodec.decode(literal)
  /** Preserves the legacy frame call shape while proving the identity generic remains concrete. */
  const frameContext = { source: 'packed-fixture', messageId: 'identity-literal' }
  const framed = messageFramer.frame(decoded, frameContext)
  const accepted = messageFramer.accept(framed[0], frameContext)
  const normalized = normalizeV1Envelope(
    rpcProtocol.normalize({ kind: 'request', id: 'packed-v1', method: 'ping', data: null })
  )
  const retainedIdentity: typeof identityCodec = identityCodec
  void [accepted, normalized, retainedIdentity]

  const topologyNodes: ITopologyNode[] = [{ id: 'packed-topology', dependencies: [], ordinal: 0 }]
  void buildCapabilityTopology(
    topologyNodes,
    () => {
      throw new Error('unexpected unknown provider')
    },
    () => {
      throw new Error('unexpected cycle')
    },
    () => {
      throw new Error('unexpected invalid topology')
    }
  )

  const nativeMiddleware = defineMiddleware('packed-native-surface', () => ({
    install: () => ({ foo: 1 as const }),
    expose: () => ({ bar: () => 'packed-bar' as const })
  }))
  const fullWithNativeMiddleware = await createComposedEndpoint(
    {
      ...config('packed-native-surface'),
      middlewares: [connect(), nativeMiddleware] as const
    },
    {
      'first-party-provider': createProviderFeature(
        createOutboundFeature(createCanonicalChunkFeature())
      )
    }
  )
  const nativeFoo: 1 = fullWithNativeMiddleware.foo
  const nativeBar: 'packed-bar' = fullWithNativeMiddleware.bar()
  const fluentNativeFoo: 1 = fullWithNativeMiddleware.provide('echo', (context) =>
    context.success(context.data)
  ).foo
  const fluentNativeBar: 'packed-bar' = fullWithNativeMiddleware
    .provide('echo', (context) => context.success(context.data))
    .bar()
  void [nativeFoo, nativeBar, fluentNativeFoo, fluentNativeBar]
  // @ts-expect-error unexposed native middleware keys remain absent from the endpoint surface.
  void fullWithNativeMiddleware.missingNativeKey

  const packedFeature = defineFeature(() => ({ custom: () => 'packed-custom' }))
  const rootWithFeature = await createComposedEndpoint(
    {
      ...config('packed-root-feature-types'),
      features: [packedFeature] as const
    },
    {}
  )
  void rootWithFeature.custom()
  const widenedFeatures = [packedFeature] as IRpcFeature[]
  /** Compile-only branch proves widened feature arrays remain rejected at the public boundary. */
  const typeOnlyBranch: boolean = false
  if (typeOnlyBranch) {
    /** The whole widened configuration remains the invalid input under test. */
    const widenedFeatureConfig = {
      ...config('packed-widened-feature-types'),
      features: widenedFeatures
    }
    // @ts-expect-error Feature composition requires a finite readonly tuple.
    void createComposedEndpoint(widenedFeatureConfig, {})
  }

  // @ts-expect-error removed context middleware objects are not native public plugins
  const legacyPlugin: IRpcPlugin = { name: 'legacy', install() {} }
  void legacyPlugin

  const grown = await createComposedEndpoint(config('packed-custom-types'), {
    custom: packedFeature
  })
  void grown.custom()

  const coreWithoutOneWay = await createComposedEndpoint(
    { id: 'packed-core-no-one-way', transport: semantic, middlewares: [] },
    {}
  )
  // @ts-expect-error an explicit empty root record does not grant one-way capability.
  void coreWithoutOneWay.sendOneWay
}

void verifyPackedContracts

/** Packed declarations keep every independently exported factory on the checked route. */
async function verifyPackedPipelineMatrix(): Promise<void> {
  await createComposedEndpoint(
    { id: 'packed-full-semantic', middlewares: [], transport: semantic },
    {}
  )
  await createComposedEndpoint({ id: 'packed-root-opaque', middlewares: [], transport: opaque }, {})
  await createComposedEndpoint(
    { id: 'packed-client-opaque', middlewares: [], transport: opaque },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'packed-provider-semantic',
      middlewares: [],
      transport: semantic
    },
    {}
  )
  await createComposedEndpoint(
    { id: 'packed-core-opaque', middlewares: [], transport: opaque },
    { packed: defineFeature(() => ({ packed: true as const })) }
  )
  await createComposedEndpoint<'packed-legacy-semantic', readonly []>(
    {
      id: 'packed-legacy-semantic',
      middlewares: [],
      transport: semantic
    },
    {}
  )
  await createComposedEndpoint<'packed-legacy-opaque', readonly []>(
    {
      id: 'packed-legacy-opaque',
      middlewares: [],
      transport: opaque
    },
    {}
  )

  // @ts-expect-error full default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint({ id: 'packed-full-string', middlewares: [], transport: text }, {})
  await createComposedEndpoint<'packed-legacy-string', readonly []>(
    {
      id: 'packed-legacy-string',
      middlewares: [],
      // @ts-expect-error explicit legacy generics cannot reopen a string-only sink.
      transport: text
    },
    {}
  )
  // @ts-expect-error root default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint({ id: 'packed-root-string', middlewares: [], transport: text }, {})
  // @ts-expect-error client default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint({ id: 'packed-client-string', middlewares: [], transport: text }, {})
  /** Default semantic transport input stays concrete across composed declarations. */
  const providerStringConfig = { id: 'packed-provider-string', middlewares: [], transport: text }
  // @ts-expect-error provider default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint(providerStringConfig, {})
  const packedCoreStringConfig = { id: 'packed-core-string', middlewares: [], transport: text }
  // @ts-expect-error core default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint(packedCoreStringConfig, {
    packed: defineFeature(() => ({ packed: true as const }))
  })

  const json = defineJsonCodec({ version: 1 })
  const stringFrames = createStringFramer()
  await createComposedEndpoint(
    {
      id: 'packed-union-frame',
      middlewares: [],
      protocol: rpcProtocol,
      codec: json,
      framer: stringFrames,
      transport: textFrames
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'packed-identity',
      middlewares: [],
      protocol: rpcProtocol,
      codec: identityCodec,
      framer: messageFramer,
      transport: semantic
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'packed-plugin-json-identity-string',
      protocol: rpcProtocol,
      middlewares: [codec(json), framer(messageFramer)] as const,
      transport: text
    },
    {}
  )
  const packedPluginJsonIdentityBinaryConfig = {
    id: 'packed-plugin-json-identity-binary',
    protocol: rpcProtocol,
    middlewares: [codec(json), framer(messageFramer)] as const,
    transport: undefined as unknown as IRpcTransport<Uint8Array>
  }
  // @ts-expect-error JSON plus identity framing cannot target a binary sink.
  await createComposedEndpoint(packedPluginJsonIdentityBinaryConfig, {})
  await createComposedEndpoint(
    {
      id: 'packed-top-level-framer-overrides-plugin-binary',
      protocol: rpcProtocol,
      framer: messageFramer,
      middlewares: [codec(json), framer(createBinaryFramer())] as const,
      transport: text
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'packed-native-string-top-level',
      protocol: rpcProtocol,
      codec: json,
      framer: stringFrames,
      middlewares: [],
      transport: textFrames
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'packed-native-string-plugin',
      protocol: rpcProtocol,
      middlewares: [codec(json), framer(stringFrames)] as const,
      transport: textFrames
    },
    {}
  )
  void framer({
    id: 'packed-invalid-accept',
    version: 1,
    inputEncodedType: 'unknown',
    outputEncodedType: 'unknown',
    frame: (value: unknown) => [value],
    // @ts-expect-error framer acceptance must return the native frame result union.
    accept: () => 123,
    close: () => undefined
  })
  const packedEncodedMismatchConfig = {
    id: 'packed-encoded-mismatch',
    middlewares: [],
    protocol: rpcProtocol,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  }
  // @ts-expect-error encoded JSON strings cannot enter a binary framer.
  await createComposedEndpoint(packedEncodedMismatchConfig, {})
  const packedStagedInboundMismatchConfig = {
    id: 'packed-staged-inbound-mismatch',
    middlewares: [],
    protocol: rpcProtocol,
    codec: undefined as unknown as ICodec<IRpcEnvelope, string>,
    framer: customStringFramer,
    transport: stagedInboundMismatch
  }
  // @ts-expect-error staged inbound data must be accepted by the selected framer.
  await createComposedEndpoint(packedStagedInboundMismatchConfig, {})
}
void verifyPackedPipelineMatrix
