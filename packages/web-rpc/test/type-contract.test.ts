import { describe, expect, expectTypeOf, it } from 'vitest'
import { createEndpoint } from '../src/index.js'
import { createFullEndpoint } from '../src/full.js'
import { createClientEndpoint } from '../src/client.js'
import { createProviderEndpoint } from '../src/provider.js'
import { createComposedEndpoint } from '../src/core.js'
import { createFirstPartyRoots } from '../src/internal/first-party-roots.js'
import { createProviderFirstPartyRoots } from '../src/internal/provider-first-party-roots.js'
import { defineFeature } from '../src/feature.js'
import { defineMiddleware } from '../src/middleware.js'
import { connect } from '../src/middleware/connect.js'
import { codec } from '../src/middleware/codec.js'
import { framer } from '../src/middleware/framer.js'
import { canonicalProtocol } from '../src/middleware/canonical-protocol.js'
import { ping } from '../src/middleware/ping.js'
import type { IMemoryTransport } from '../src/adapters/memory.js'
import type { IWebRpcPingOptions } from '../src/typing.js'
import type { IWebRpcFactoryConfig } from '../src/typing.js'
import type { IRpcEnvelope, IRpcProtocol, IRpcFramer } from '@migaia/rpc-contract'
import type { ICodec } from '@migaia/serialize/codec'
import type { IWebRpcTransport } from '../src/transport.js'
import { createDescriptor, rpcProtocolV1, type IRpcStringFrame } from '@migaia/rpc-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { identityCodecV1 } from '@migaia/serialize/codec'
import {
  createBinaryFramer,
  createStringFramer,
  messageFramerV1
} from '@migaia/rpc-contract/framing'

/** Explicitly preserves the runtime default rather than widening `connect`'s generic return. */
type IAutomaticMiddlewareList = readonly [ReturnType<typeof connect<'automatic'>>]
type IManualMiddlewareList = readonly [
  ReturnType<typeof connect<'manual'>>,
  ReturnType<typeof ping>
]
type IAutomaticEndpoint = Awaited<
  ReturnType<typeof createEndpoint<'automatic-target', IAutomaticMiddlewareList>>
>
type IManualEndpoint = Awaited<
  ReturnType<typeof createEndpoint<'manual-target', IManualMiddlewareList>>
>
declare const opaque: IWebRpcTransport<unknown>
declare const semantic: IWebRpcTransport<IRpcEnvelope>
declare const text: IWebRpcTransport<string>
declare const textFrames: IWebRpcTransport<string | IRpcStringFrame>
declare const legacyCustom: IRpcFramer<string, string, 'custom', 1>

async function assertInferredFactoryContract(): Promise<void> {
  const automatic = await createEndpoint({
    id: 'automatic-target',
    middlewares: [connect({ transport: undefined as never })]
  })
  // @ts-expect-error automatic discovery does not expose manual query controls
  void automatic.connect.query
  const manual = await createEndpoint({
    id: 'manual-target',
    middlewares: [connect({ transport: undefined as never, discoveryMode: 'manual' }), ping()]
  })
  void manual.connect.query
  void manual.ping
}
void assertInferredFactoryContract

async function assertSelectedRootProjection(): Promise<void> {
  const chunkOnly = await createComposedEndpoint(
    { id: 'chunk-only', transport: undefined as never, middlewares: [] },
    createFirstPartyRoots(new Set(['first-party-chunk'] as const))
  )
  // @ts-expect-error chunk root has no implicit outbound capability
  void chunkOnly.send

  const discoveryOnly = await createComposedEndpoint(
    { id: 'discovery-only', transport: undefined as never, middlewares: [] },
    createFirstPartyRoots(new Set(['first-party-discovery'] as const))
  )
  // @ts-expect-error discovery roots do not inherit outbound methods from dependencies
  void discoveryOnly.send

  const provider = await createComposedEndpoint(
    { id: 'provider-root', transport: undefined as never, middlewares: [] },
    createProviderFirstPartyRoots()
  )
  void provider.send
  void provider.provide
  // @ts-expect-error provider preset omits unselected discovery controls.
  void provider.discover

  const publicFeature = defineFeature(() => ({
    prepare: () => ({ public: { x: 1 } }),
    other: 2
  }))
  const publicFeatureEndpoint = await createComposedEndpoint(
    { id: 'public-feature-root', transport: undefined as never, middlewares: [] },
    { feature: publicFeature }
  )
  void publicFeatureEndpoint.prepare
  void publicFeatureEndpoint.other
  // @ts-expect-error a non-first-party prepare-shaped output does not project its nested public value.
  void publicFeatureEndpoint.x
}
void assertSelectedRootProjection

/** Proves the runtime guard rejects an untyped legacy tuple before endpoint construction. */
it('YS19 rejects an untyped legacy tuple before native composition', async () => {
  /** The tuple models a JavaScript caller bypassing the root-record TypeScript signature. */
  const forgedRoots = [{}] as unknown as Readonly<
    Record<string, import('../src/feature.js').IWebRpcFeature>
  >
  await expect(
    createComposedEndpoint(
      { id: 'retired-module-runtime-rejection', transport: undefined as never, middlewares: [] },
      forgedRoots
    )
  ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
})

/** W1 proves the public async factory preserves each adjacent pipeline edge. */
const validPipeline: IWebRpcFactoryConfig<
  string,
  readonly [],
  readonly [],
  IRpcEnvelope,
  string,
  string
> = {
  id: 'typed-pipeline',
  middlewares: [],
  protocol: undefined as unknown as IRpcProtocol<IRpcEnvelope, string, number>,
  codec: undefined as unknown as ICodec<IRpcEnvelope, string>,
  framer: undefined as unknown as IRpcFramer<string, string, string, number>,
  transport: undefined as unknown as IWebRpcTransport<string>
}
const invalidCodecInput: IWebRpcFactoryConfig<
  string,
  readonly [],
  readonly [],
  IRpcEnvelope,
  string,
  string
> = {
  ...validPipeline,
  // @ts-expect-error codec input must accept the selected protocol envelope.
  codec: undefined as unknown as ICodec<{ readonly value: string }, string>
}
const invalidFramerInput: IWebRpcFactoryConfig<
  string,
  readonly [],
  readonly [],
  IRpcEnvelope,
  string,
  string
> = {
  ...validPipeline,
  // @ts-expect-error framer input must equal codec output.
  framer: undefined as unknown as IRpcFramer<Uint8Array, string, string, number>
}
const invalidTransportInput: IWebRpcFactoryConfig<
  string,
  readonly [],
  readonly [],
  IRpcEnvelope,
  string,
  string
> = {
  ...validPipeline,
  // @ts-expect-error transport input must equal framer output.
  transport: undefined as unknown as IWebRpcTransport<Uint8Array>
}
void [validPipeline, invalidCodecInput, invalidFramerInput, invalidTransportInput]

async function assertInferredPipelineEdges(): Promise<void> {
  await createEndpoint({
    id: 'inferred-pipeline',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: defineJsonCodec({ version: 1 }),
    framer: createStringFramer({ chunkBytes: 1024 }),
    transport: undefined as unknown as IWebRpcTransport<
      ReturnType<ReturnType<typeof createStringFramer>['frame']>[number]
    >
  })
  // @ts-expect-error codec input cannot narrow the inferred protocol envelope.
  await createEndpoint({
    id: 'bad-codec',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: undefined as unknown as ICodec<{ readonly value: string }, string>,
    transport: undefined as never
  })
  // @ts-expect-error framer input cannot differ from codec output.
  await createEndpoint({
    id: 'bad-framer',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: undefined as unknown as ICodec<IRpcEnvelope, string>,
    framer: undefined as unknown as IRpcFramer<Uint8Array, string, string, number>,
    transport: undefined as never
  })
  // @ts-expect-error transport input cannot differ from framer output.
  await createEndpoint({
    id: 'bad-transport',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: undefined as unknown as ICodec<IRpcEnvelope, string>,
    framer: undefined as unknown as IRpcFramer<string, string, string, number>,
    transport: undefined as unknown as IWebRpcTransport<Uint8Array>
  })
  void createDescriptor
}
void assertInferredPipelineEdges

/** F0 keeps every public factory on one directed, concrete pipeline contract. */
async function assertPublicFactoryPipelineMatrix(): Promise<void> {
  const identityLiteral: { readonly x: 1 } = identityCodecV1.encode({ x: 1 } as const)
  const preservedLegacy: IRpcFramer<string, string, 'custom', 1> = legacyCustom
  void [identityLiteral, preservedLegacy]

  await createFullEndpoint<'peer', readonly []>({
    id: 'full-legacy-semantic',
    middlewares: [],
    transport: semantic
  })
  await createFullEndpoint<'peer', readonly []>({
    id: 'full-legacy-opaque',
    middlewares: [],
    transport: opaque
  })
  await createEndpoint({ id: 'root-semantic', middlewares: [], transport: semantic })
  await createClientEndpoint({ id: 'client-opaque', middlewares: [], transport: opaque })
  await createProviderEndpoint({ id: 'provider-semantic', middlewares: [], transport: semantic })
  await createComposedEndpoint(
    { id: 'core-opaque', middlewares: [], transport: opaque },
    createProviderFirstPartyRoots()
  )

  const json = defineJsonCodec({ version: 1 })
  const frames = createStringFramer()
  await createFullEndpoint({
    id: 'json-frame-union',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: frames,
    transport: textFrames
  })
  await createFullEndpoint({
    id: 'json-opaque',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: frames,
    transport: opaque
  })
  await createFullEndpoint({
    id: 'identity-semantic',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: identityCodecV1,
    framer: messageFramerV1,
    transport: semantic
  })

  // @ts-expect-error default semantic envelopes cannot use a string-only sink.
  await createFullEndpoint({ id: 'default-string', middlewares: [], transport: text })
  // @ts-expect-error root default semantic envelopes cannot use a string-only sink.
  await createEndpoint({ id: 'root-default-string', middlewares: [], transport: text })
  // @ts-expect-error client default semantic envelopes cannot use a string-only sink.
  await createClientEndpoint({ id: 'client-default-string', middlewares: [], transport: text })
  // @ts-expect-error provider default semantic envelopes cannot use a string-only sink.
  await createProviderEndpoint({ id: 'provider-default-string', middlewares: [], transport: text })
  // @ts-expect-error core default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint(
    { id: 'core-default-string', middlewares: [], transport: text },
    createProviderFirstPartyRoots()
  )
  await createFullEndpoint<'peer', readonly []>({
    id: 'legacy-string',
    middlewares: [],
    // @ts-expect-error explicit legacy generics cannot reopen a string-only sink.
    transport: text
  })
  // @ts-expect-error string-framer output includes fragment frames, not only strings.
  await createEndpoint({
    id: 'json-string-only',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: frames,
    transport: text
  })
  // @ts-expect-error binary framing cannot consume JSON string codec output.
  await createClientEndpoint({
    id: 'client-binary-mismatch',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  })
  // @ts-expect-error provider cannot reopen the encoded binary mismatch.
  await createProviderEndpoint({
    id: 'provider-binary-mismatch',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  })
  const badCore = {
    id: 'core-binary-mismatch',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  }
  // @ts-expect-error composed entry cannot reopen the encoded binary mismatch.
  await createComposedEndpoint(badCore, [provider()] as const)

  await createFullEndpoint({
    id: 'plugin-json-identity-string',
    middlewares: [canonicalProtocol(rpcProtocolV1), codec(json), framer(messageFramerV1)] as const,
    transport: text
  })
  // @ts-expect-error JSON plus identity framing cannot target a binary sink.
  await createFullEndpoint({
    id: 'plugin-json-identity-binary',
    middlewares: [canonicalProtocol(rpcProtocolV1), codec(json), framer(messageFramerV1)] as const,
    transport: undefined as unknown as IWebRpcTransport<Uint8Array>
  })
  await createFullEndpoint({
    id: 'top-level-framer-overrides-plugin-binary',
    protocol: rpcProtocolV1,
    framer: messageFramerV1,
    middlewares: [
      canonicalProtocol(rpcProtocolV1),
      codec(json),
      framer(createBinaryFramer())
    ] as const,
    transport: text
  })
  await createFullEndpoint({
    id: 'native-string-top-level',
    protocol: rpcProtocolV1,
    codec: json,
    framer: frames,
    middlewares: [],
    transport: textFrames
  })
  await createFullEndpoint({
    id: 'native-string-plugin',
    middlewares: [canonicalProtocol(rpcProtocolV1), codec(json), framer(frames)] as const,
    transport: textFrames
  })
  // @ts-expect-error a custom protocol identity requires its supplied descriptor.
  void canonicalProtocol<IRpcProtocol<IRpcEnvelope, 'forged.protocol', 1>>()
  void framer({
    id: 'invalid-accept',
    version: 1,
    inputEncodedType: 'unknown',
    outputEncodedType: 'unknown',
    frame: (value: unknown) => [value],
    // @ts-expect-error framer acceptance must return the native frame result union.
    accept: () => 123,
    close: () => undefined
  })

  const feature = defineFeature({
    install: () => ({ typeMatrix: () => 1 }),
    publicKeys: ['typeMatrix']
  })
  const featured = await createFullEndpoint({
    id: 'feature-surface',
    middlewares: [],
    features: [feature] as const,
    transport: opaque
  })
  const exact: number = featured.typeMatrix()
  void exact
  const requiredFeature = defineFeature<
    { readonly root: () => string },
    Record<never, never>,
    { readonly alias: () => string }
  >((core) => ({ root: () => core.featureExpose.alias() }))
  // @ts-expect-error feature records require their declared featureExpose contract.
  void defineMiddleware('missing-feature-expose', () => ({ expose: () => ({}) }), {
    alias: requiredFeature
  })
  const objectMiddleware = defineMiddleware({
    name: 'object-component-contribution',
    metadata: {
      claims: {
        routes: [],
        provides: [],
        consumes: [],
        publicKeys: [],
        exposedKeys: [],
        activator: false
      }
    },
    discoveryMode: 'manual' as const,
    pingCapability: true as const,
    install: () => ({ extension: {}, shared: {} })
  })
  const objectComponentEndpoint = await createFullEndpoint({
    id: 'object-component-contribution',
    transport: opaque,
    middlewares: [objectMiddleware] as const
  })
  void objectComponentEndpoint.connect.query
  void objectComponentEndpoint.ping
}
void assertPublicFactoryPipelineMatrix

describe('factory type contract', () => {
  it('discriminates discovery mode and ping capability', () => {
    expectTypeOf<
      'query' extends keyof IAutomaticEndpoint['connect'] ? true : false
    >().toEqualTypeOf<false>()
    expectTypeOf<
      'query' extends keyof IManualEndpoint['connect'] ? true : false
    >().toEqualTypeOf<true>()
    expectTypeOf<'ping' extends keyof IAutomaticEndpoint ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<'ping' extends keyof IManualEndpoint ? true : false>().toEqualTypeOf<true>()
    expectTypeOf<IManualEndpoint['ping']>().toEqualTypeOf<
      (targetId: string, receiverId?: string, options?: IWebRpcPingOptions) => Promise<boolean>
    >()
  })

  it('keeps the public memory close specialization synchronous', () => {
    expectTypeOf<ReturnType<IMemoryTransport['close']>>().toEqualTypeOf<void>()
  })
})
