import { describe, expect, expectTypeOf, it } from 'vitest'

import { createComposedEndpoint } from '../../dist/core/composed.js'

import { defineFeature } from '../../dist/core/feature.js'
import { defineMiddleware } from '../../dist/core/middleware.js'
import { codec } from '../../dist/core/middleware/codec.js'
import { framer } from '../../dist/core/middleware/framer.js'
import { canonicalProtocol } from '../fixtures/core-role/canonical-protocol.js'
import type { IMemoryTransport } from '../fixtures/memory-transport.js'
import type { IRpcFactoryConfig } from '../../dist/core/typing.js'
import type { IRpcEnvelope, IRpcProtocol, IRpcFramer } from '@migaia/rpc-contract'
import type { ICodec } from '@migaia/serialize/codec'
import type { IRpcTransport } from '../../dist/core/transport.js'
import { createDescriptor, rpcProtocolV1, type IRpcStringFrame } from '@migaia/rpc-contract'
import { defineJsonCodec } from '@migaia/serialize/codecs/json'
import { identityCodec } from '@migaia/serialize/codecs/identity/v1'
import {
  createBinaryFramer,
  createStringFramer,
  messageFramerV1
} from '@migaia/rpc-contract/framing'

declare const opaque: IRpcTransport<unknown>
declare const semantic: IRpcTransport<IRpcEnvelope>
declare const text: IRpcTransport<string>
declare const textFrames: IRpcTransport<string | IRpcStringFrame>
declare const legacyCustom: IRpcFramer<string, string, 'custom', 1>

async function assertNativeRootProjection(): Promise<void> {
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
void assertNativeRootProjection

/** Proves the runtime guard rejects an untyped legacy tuple before endpoint construction. */
it('rejects an untyped legacy tuple before native composition', async () => {
  /** The tuple models a JavaScript caller bypassing the root-record TypeScript signature. */
  const forgedRoots = [{}] as unknown as Readonly<
    Record<string, import('../../dist/core/feature.js').IRpcFeature>
  >
  await expect(
    createComposedEndpoint(
      { id: 'retired-module-runtime-rejection', transport: undefined as never, middlewares: [] },
      forgedRoots
    )
  ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
})

/** Proves the public async factory preserves each adjacent pipeline edge. */
const validPipeline: IRpcFactoryConfig<
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
  transport: undefined as unknown as IRpcTransport<string>
}
const invalidCodecInput: IRpcFactoryConfig<
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
const invalidFramerInput: IRpcFactoryConfig<
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
const invalidTransportInput: IRpcFactoryConfig<
  string,
  readonly [],
  readonly [],
  IRpcEnvelope,
  string,
  string
> = {
  ...validPipeline,
  // @ts-expect-error transport input must equal framer output.
  transport: undefined as unknown as IRpcTransport<Uint8Array>
}
void [validPipeline, invalidCodecInput, invalidFramerInput, invalidTransportInput]

async function assertInferredPipelineEdges(): Promise<void> {
  await createComposedEndpoint(
    {
      id: 'inferred-pipeline',
      middlewares: [],
      protocol: rpcProtocolV1,
      codec: defineJsonCodec({ version: 1 }),
      framer: createStringFramer({ chunkBytes: 1024 }),
      transport: undefined as unknown as IRpcTransport<
        ReturnType<ReturnType<typeof createStringFramer>['frame']>[number]
      >
    },
    {}
  )
  const badCodecConfig = {
    id: 'bad-codec',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: undefined as unknown as ICodec<{ readonly value: string }, string>,
    transport: undefined as never
  }
  // @ts-expect-error codec input cannot narrow the inferred protocol envelope.
  await createComposedEndpoint(badCodecConfig, {})
  const badFramerConfig = {
    id: 'bad-framer',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: undefined as unknown as ICodec<IRpcEnvelope, string>,
    framer: undefined as unknown as IRpcFramer<Uint8Array, string, string, number>,
    transport: undefined as never
  }
  // @ts-expect-error framer input cannot differ from codec output.
  await createComposedEndpoint(badFramerConfig, {})
  const badTransportConfig = {
    id: 'bad-transport',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: undefined as unknown as ICodec<IRpcEnvelope, string>,
    framer: undefined as unknown as IRpcFramer<string, string, string, number>,
    transport: undefined as unknown as IRpcTransport<Uint8Array>
  }
  // @ts-expect-error transport input cannot differ from framer output.
  await createComposedEndpoint(badTransportConfig, {})
  void createDescriptor
}
void assertInferredPipelineEdges

/** Keeps every public factory on one directed, concrete pipeline contract. */
async function assertPublicFactoryPipelineMatrix(): Promise<void> {
  const identityLiteral: { readonly x: 1 } = identityCodec.encode({ x: 1 } as const)
  const preservedLegacy: IRpcFramer<string, string, 'custom', 1> = legacyCustom
  void [identityLiteral, preservedLegacy]

  await createComposedEndpoint({ id: 'root-semantic', middlewares: [], transport: semantic }, {})
  await createComposedEndpoint({ id: 'client-opaque', middlewares: [], transport: opaque }, {})
  await createComposedEndpoint(
    { id: 'provider-semantic', middlewares: [], transport: semantic },
    {}
  )
  await createComposedEndpoint({ id: 'core-opaque', middlewares: [], transport: opaque }, {})

  const json = defineJsonCodec({ version: 1 })
  const frames = createStringFramer()
  await createComposedEndpoint(
    {
      id: 'json-frame-union',
      middlewares: [],
      protocol: rpcProtocolV1,
      codec: json,
      framer: frames,
      transport: textFrames
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'json-opaque',
      middlewares: [],
      protocol: rpcProtocolV1,
      codec: json,
      framer: frames,
      transport: opaque
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'identity-semantic',
      middlewares: [],
      protocol: rpcProtocolV1,
      codec: identityCodec,
      framer: messageFramerV1,
      transport: semantic
    },
    {}
  )

  // @ts-expect-error default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint({ id: 'default-string', middlewares: [], transport: text }, {})
  // @ts-expect-error root default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint({ id: 'root-default-string', middlewares: [], transport: text }, {})
  await createComposedEndpoint(
    // @ts-expect-error default semantic envelopes cannot use a string-only sink.
    { id: 'client-default-string', middlewares: [], transport: text },
    {}
  )
  await createComposedEndpoint(
    // @ts-expect-error default semantic envelopes cannot use a string-only sink.
    { id: 'provider-default-string', middlewares: [], transport: text },
    {}
  )
  const coreDefaultStringConfig = { id: 'core-default-string', middlewares: [], transport: text }
  // @ts-expect-error core default semantic envelopes cannot use a string-only sink.
  await createComposedEndpoint(coreDefaultStringConfig, {})

  const jsonStringOnlyConfig = {
    id: 'json-string-only',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: frames,
    transport: text
  }
  // @ts-expect-error string-framer output includes fragment frames, not only strings.
  await createComposedEndpoint(jsonStringOnlyConfig, {})
  const clientBinaryMismatchConfig = {
    id: 'client-binary-mismatch',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  }
  // @ts-expect-error binary framing cannot consume JSON string codec output.
  await createComposedEndpoint(clientBinaryMismatchConfig, {})
  const providerBinaryMismatchConfig = {
    id: 'provider-binary-mismatch',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  }
  // @ts-expect-error provider cannot reopen the encoded binary mismatch.
  await createComposedEndpoint(providerBinaryMismatchConfig, {})
  const badCore = {
    id: 'core-binary-mismatch',
    middlewares: [],
    protocol: rpcProtocolV1,
    codec: json,
    framer: createBinaryFramer(),
    transport: opaque
  }
  // @ts-expect-error composed entry cannot reopen the encoded binary mismatch.
  await createComposedEndpoint(badCore, {})

  await createComposedEndpoint(
    {
      id: 'plugin-json-identity-string',
      middlewares: [
        canonicalProtocol(rpcProtocolV1),
        codec(json),
        framer(messageFramerV1)
      ] as const,
      transport: text
    },
    {}
  )
  const pluginJsonIdentityBinaryConfig = {
    id: 'plugin-json-identity-binary',
    middlewares: [canonicalProtocol(rpcProtocolV1), codec(json), framer(messageFramerV1)] as const,
    transport: undefined as unknown as IRpcTransport<Uint8Array>
  }
  // @ts-expect-error JSON plus identity framing cannot target a binary sink.
  await createComposedEndpoint(pluginJsonIdentityBinaryConfig, {})
  await createComposedEndpoint(
    {
      id: 'top-level-framer-overrides-plugin-binary',
      protocol: rpcProtocolV1,
      framer: messageFramerV1,
      middlewares: [
        canonicalProtocol(rpcProtocolV1),
        codec(json),
        framer(createBinaryFramer())
      ] as const,
      transport: text
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'native-string-top-level',
      protocol: rpcProtocolV1,
      codec: json,
      framer: frames,
      middlewares: [],
      transport: textFrames
    },
    {}
  )
  await createComposedEndpoint(
    {
      id: 'native-string-plugin',
      middlewares: [canonicalProtocol(rpcProtocolV1), codec(json), framer(frames)] as const,
      transport: textFrames
    },
    {}
  )
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
  const featured = await createComposedEndpoint(
    {
      id: 'feature-surface',
      middlewares: [],
      features: [feature] as const,
      transport: opaque
    },
    {}
  )
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
}
void assertPublicFactoryPipelineMatrix

describe('factory type contract', () => {
  it('keeps the public memory close specialization synchronous', () => {
    expectTypeOf<ReturnType<IMemoryTransport['close']>>().toEqualTypeOf<void>()
  })
})
