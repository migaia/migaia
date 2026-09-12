import { createComposedEndpoint } from '@migaia/web-rpc/core'
import { createProviderEndpoint } from '@migaia/web-rpc/provider'
import { createFullEndpoint } from '@migaia/web-rpc/full'
import { createClientEndpoint } from '@migaia/web-rpc/client'
import {
  connect,
  codec,
  createEndpoint,
  defineFeature,
  defineMiddleware,
  framer,
  protocol as canonicalProtocol,
  type IWebRpcFeature,
  type IWebRpcPlugin
} from '@migaia/web-rpc'
import { buildCapabilityTopology, type ITopologyNode } from '@migaia/capability/graph/topology'
import rpcV1, { rpcProtocol } from '@migaia/rpc-contract/v1'
import { messageFramer } from '@migaia/rpc-contract/framing/v1'
import { createBinaryFramer, createStringFramer } from '@migaia/rpc-contract/framing'
import type { IRpcEnvelope, IRpcFramer, IRpcStringFrame } from '@migaia/rpc-contract'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import { identityCodecV1 } from '@migaia/serialize/codec'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import type { ICodec } from '@migaia/serialize/codec'
import type { IWebRpcTransport } from '@migaia/web-rpc'

declare const semantic: IWebRpcTransport<IRpcEnvelope>
declare const opaque: IWebRpcTransport<unknown>
declare const text: IWebRpcTransport<string>
declare const textFrames: IWebRpcTransport<string | IRpcStringFrame>
declare const customStringFramer: IRpcFramer<string, string, 'custom', 1>
declare const stagedInboundMismatch: Omit<
  IWebRpcTransport<string | IRpcStringFrame>,
  'subscribe'
> & {
  readonly subscribe: (listener: (message: { readonly data: Uint8Array }) => void) => () => void
}

/** Provides the smallest configuration accepted by packed type consumers. */
function config(id: string) {
  return { id, transport: undefined as never, middlewares: [connect()] as const }
}

async function verifyPackedContracts(): Promise<void> {
  const literal: { readonly packed: true } = identityCodec.encode({ packed: true } as const)
  const decoded: { readonly packed: true } = identityCodec.decode(literal)
  /** Preserves the legacy frame call shape while proving the identity generic remains concrete. */
  const frameContext = { source: 'packed-fixture', messageId: 'identity-literal' }
  const framed = messageFramer.frame(decoded, frameContext)
  const accepted = messageFramer.accept(framed[0], frameContext)
  const normalized = rpcV1.normalizeRpcEnvelope(
    rpcProtocol.normalize({ kind: 'request', id: 'packed-v1', method: 'ping', data: null })
  )
  const retainedIdentity: typeof identityCodec = identityCodecV1
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

  const full = await createFullEndpoint(config('packed-full-types'))
  void full.connect
  void full.discovery
  void full.provide('echo', (context) => context.success(context.data)).connect
  void full.provide('echo', (context) => context.success(context.data)).discovery

  const root = await createEndpoint(config('packed-root-types'))
  void root.provide('echo', (context) => context.success(context.data)).connect
  void root.provide('echo', (context) => context.success(context.data)).discovery

  const nativeMiddleware = defineMiddleware('packed-native-surface', () => ({
    install: () => ({ foo: 1 as const }),
    expose: () => ({ bar: () => 'packed-bar' as const })
  }))
  const fullWithNativeMiddleware = await createFullEndpoint({
    ...config('packed-native-surface'),
    middlewares: [connect(), nativeMiddleware] as const
  })
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
  const rootWithFeature = await createEndpoint({
    ...config('packed-root-feature-types'),
    features: [packedFeature] as const
  })
  void rootWithFeature.custom()
  const widenedFeatures = [packedFeature] as IWebRpcFeature[]
  /** Compile-only branch proves widened feature arrays remain rejected at the public boundary. */
  const typeOnlyBranch: boolean = false
  if (typeOnlyBranch) {
    // @ts-expect-error Feature composition requires a finite readonly tuple.
    void createEndpoint({ ...config('packed-widened-feature-types'), features: widenedFeatures })
  }

  // @ts-expect-error removed context middleware objects are not native public plugins
  const legacyPlugin: IWebRpcPlugin = { name: 'legacy', install() {} }
  void legacyPlugin

  const providerEndpoint = await createProviderEndpoint(config('packed-provider-types'))
  // @ts-expect-error slim provider roots do not expose discovery
  void providerEndpoint.discovery
  // @ts-expect-error slim provider roots do not expose connect
  void providerEndpoint.connect

  const grown = await createComposedEndpoint(config('packed-custom-types'), {
    custom: packedFeature
  })
  void grown.custom()

  const publicTuple = await createFullEndpoint(config('packed-public-tuple-types'))
  void publicTuple.send
  void publicTuple.connect
  void publicTuple.discovery

  // @ts-expect-error default public roots do not expose the private one-way capability.
  void publicTuple.sendOneWay
  const clientWithoutOneWay = await createClientEndpoint({
    id: 'packed-client-no-one-way',
    transport: semantic,
    middlewares: []
  })
  // @ts-expect-error client roots without oneWay do not expose sendOneWay
  void clientWithoutOneWay.sendOneWay
  const providerWithoutOneWay = await createProviderEndpoint({
    id: 'packed-provider-no-one-way',
    transport: semantic,
    middlewares: []
  })
  // @ts-expect-error provider roots without oneWay do not expose sendOneWay
  void providerWithoutOneWay.sendOneWay
  const rootWithoutOneWay = await createEndpoint({
    id: 'packed-root-no-one-way',
    transport: semantic,
    middlewares: []
  })
  // @ts-expect-error default roots without oneWay do not expose sendOneWay
  void rootWithoutOneWay.sendOneWay
}

void verifyPackedContracts

/** D33 packed declarations keep every independently exported factory on the checked route. */
async function verifyPackedPipelineMatrix(): Promise<void> {
  await createFullEndpoint({ id: 'packed-full-semantic', middlewares: [], transport: semantic })
  await createEndpoint({ id: 'packed-root-opaque', middlewares: [], transport: opaque })
  await createClientEndpoint({ id: 'packed-client-opaque', middlewares: [], transport: opaque })
  await createProviderEndpoint({
    id: 'packed-provider-semantic',
    middlewares: [],
    transport: semantic
  })
  await createComposedEndpoint(
    { id: 'packed-core-opaque', middlewares: [], transport: opaque },
    { packed: defineFeature(() => ({ packed: true as const })) }
  )
  await createFullEndpoint<'packed-legacy-semantic', readonly []>({
    id: 'packed-legacy-semantic',
    middlewares: [],
    transport: semantic
  })
  await createFullEndpoint<'packed-legacy-opaque', readonly []>({
    id: 'packed-legacy-opaque',
    middlewares: [],
    transport: opaque
  })

  // @ts-expect-error full default semantic envelopes cannot use a string-only sink.
  await createFullEndpoint({ id: 'packed-full-string', middlewares: [], transport: text })
  await createFullEndpoint<'packed-legacy-string', readonly []>({
    id: 'packed-legacy-string',
    middlewares: [],
    // @ts-expect-error explicit legacy generics cannot reopen a string-only sink.
    transport: text
  })
  // @ts-expect-error root default semantic envelopes cannot use a string-only sink.
  await createEndpoint({ id: 'packed-root-string', middlewares: [], transport: text })
  // @ts-expect-error client default semantic envelopes cannot use a string-only sink.
  await createClientEndpoint({ id: 'packed-client-string', middlewares: [], transport: text })
  // @ts-expect-error provider default semantic envelopes cannot use a string-only sink.
  await createProviderEndpoint({ id: 'packed-provider-string', middlewares: [], transport: text })
  // @ts-expect-error core default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint(
    { id: 'packed-core-string', middlewares: [], transport: text },
    { packed: defineFeature(() => ({ packed: true as const })) }
  )

  const json = defineJsonCodec({ version: 1 })
  const stringFrames = createStringFramer()
  await createFullEndpoint({
    id: 'packed-union-frame',
    middlewares: [],
    protocol: rpcProtocol,
    codec: json,
    framer: stringFrames,
    transport: textFrames
  })
  await createFullEndpoint({
    id: 'packed-identity',
    middlewares: [],
    protocol: rpcProtocol,
    codec: identityCodec,
    framer: messageFramer,
    transport: semantic
  })
  await createFullEndpoint({
    id: 'packed-plugin-json-identity-string',
    middlewares: [canonicalProtocol(rpcProtocol), codec(json), framer(messageFramer)] as const,
    transport: text
  })
  // @ts-expect-error JSON plus identity framing cannot target a binary sink.
  await createFullEndpoint({
    id: 'packed-plugin-json-identity-binary',
    middlewares: [canonicalProtocol(rpcProtocol), codec(json), framer(messageFramer)] as const,
    transport: undefined as unknown as IWebRpcTransport<Uint8Array>
  })
  await createFullEndpoint({
    id: 'packed-top-level-framer-overrides-plugin-binary',
    protocol: rpcProtocol,
    framer: messageFramer,
    middlewares: [
      canonicalProtocol(rpcProtocol),
      codec(json),
      framer(createBinaryFramer())
    ] as const,
    transport: text
  })
  await createFullEndpoint({
    id: 'packed-native-string-top-level',
    protocol: rpcProtocol,
    codec: json,
    framer: stringFrames,
    middlewares: [],
    transport: textFrames
  })
  await createFullEndpoint({
    id: 'packed-native-string-plugin',
    middlewares: [canonicalProtocol(rpcProtocol), codec(json), framer(stringFrames)] as const,
    transport: textFrames
  })
  // @ts-expect-error a custom protocol identity requires its supplied descriptor.
  void canonicalProtocol<IRpcProtocol<IRpcEnvelope, 'forged.protocol', 1>>()
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
  // @ts-expect-error encoded JSON strings cannot enter a binary framer.
  await createClientEndpoint({
    id: 'packed-encoded-mismatch',
    middlewares: [],
    protocol: rpcProtocol,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  })
  // @ts-expect-error staged inbound data must be accepted by the selected framer.
  await createFullEndpoint({
    id: 'packed-staged-inbound-mismatch',
    middlewares: [],
    protocol: rpcProtocol,
    codec: undefined as unknown as ICodec<IRpcEnvelope, string>,
    framer: customStringFramer,
    transport: stagedInboundMismatch
  })
}
void verifyPackedPipelineMatrix
