import { rpcProtocolV1, type IRpcEnvelope } from '@migaia/rpc-contract'
import type { identityCodecV1 } from '@migaia/serialize/codec'
import type { messageFramerV1 } from '@migaia/rpc-contract/framing'
import type { IWebRpcFactoryConfig, IWebRpcMiddleware } from './typing.js'
import type { IWebRpcFeature, IWebRpcFiniteFeatureTuple } from './feature.js'
import type { IWebRpcTransport, IWebRpcSendOptions } from './transport.js'

/** Extracts the first parameter of a callback without widening it to unknown. */
type IArg<T> = T extends (value: infer TValue, ...rest: never[]) => unknown ? TValue : never
/** Extracts a callback result. */
type IResult<T> = T extends (...args: never[]) => infer TValue ? TValue : never
/** Reads one component property only when it exists. */
type IMember<T, TKey extends PropertyKey> = TKey extends keyof T ? T[TKey] : never
type IAny<T> = 0 extends 1 & T ? true : false
type IEqual<TLeft, TRight> =
  (<T>() => T extends TLeft ? 1 : 2) extends <T>() => T extends TRight ? 1 : 2
    ? (<T>() => T extends TRight ? 1 : 2) extends <T>() => T extends TLeft ? 1 : 2
      ? true
      : false
    : false
/** Selects first middleware contribution for one component without widening tuple order. */
type IMiddlewareContribution<
  TMiddlewares,
  TKey extends PropertyKey,
  TDefault
> = TMiddlewares extends readonly [infer TFirst, ...infer TRest]
  ? TFirst extends { readonly [TProperty in TKey]: infer TValue }
    ? TValue
    : IMiddlewareContribution<TRest, TKey, TDefault>
  : TDefault
/** Selects the required top-level component before middleware and owner defaults. */
type IComponent<T, TKey extends PropertyKey, TDefault> = T extends {
  readonly [TProperty in TKey]: infer TValue
}
  ? TValue
  : IMiddlewareContribution<IMiddlewares<T>, TKey, TDefault>
type ICodec<T> = IComponent<T, 'codec', typeof identityCodecV1>
type IFramer<T> = IComponent<T, 'framer', typeof messageFramerV1>
type ITransport<T> = IComponent<T, 'transport', IWebRpcTransport<unknown>>
type IEnvelope<T> =
  IComponent<T, 'protocol', typeof rpcProtocolV1> extends {
    readonly normalize: infer TValue
  }
    ? IResult<TValue>
    : IRpcEnvelope
type IIdentityCodec<T> = ICodec<T> extends typeof identityCodecV1 ? true : false
type IIdentityFramer<T> = IFramer<T> extends typeof messageFramerV1 ? true : false
type IEncodeInput<T> =
  IIdentityCodec<T> extends true ? IEnvelope<T> : IArg<IMember<ICodec<T>, 'encode'>>
type IEncoded<T> =
  IIdentityCodec<T> extends true ? IEnvelope<T> : IResult<IMember<ICodec<T>, 'encode'>>
type IFrameInput<T> =
  IIdentityFramer<T> extends true ? IEncoded<T> : IArg<IMember<IFramer<T>, 'frame'>>
type IFrameOutput<T> =
  IIdentityFramer<T> extends true
    ? IEncoded<T>
    : IResult<IMember<IFramer<T>, 'frame'>> extends readonly (infer TValue)[]
      ? TValue
      : never
type ISend<T> = IArg<IMember<ITransport<T>, 'send'>>
type IIncoming<T> =
  IArg<IArg<IMember<ITransport<T>, 'subscribe'>>> extends { readonly data: infer TValue }
    ? TValue
    : never
type IAcceptInput<T> =
  IIdentityFramer<T> extends true ? unknown : IArg<IMember<IFramer<T>, 'accept'>>
type IAccepted<T> =
  IIdentityFramer<T> extends true
    ? IIncoming<T>
    : Extract<IResult<IMember<IFramer<T>, 'accept'>>, { status: 'complete' }> extends {
          readonly value: infer TValue
        }
      ? TValue
      : never
type IDecodeInput<T> =
  IIdentityCodec<T> extends true ? IAccepted<T> : IArg<IMember<ICodec<T>, 'decode'>>
type IAnyComponent<T> =
  IAny<ICodec<T>> extends true ? true : IAny<IFramer<T>> extends true ? true : IAny<ITransport<T>>

/** Retains configured middleware tuple precision. */
export type IMiddlewares<T> = T extends {
  readonly middlewares: infer TValue extends readonly IWebRpcMiddleware[]
}
  ? TValue
  : readonly []
/** Retains configured custom-feature tuple precision. */
export type IFeatures<T> = T extends {
  readonly features: infer TValue extends readonly IWebRpcFeature[]
}
  ? TValue
  : readonly []
/** Retains configured endpoint target identifiers. */
export type ITarget<T> = T extends { readonly targetIds: readonly (infer TValue extends string)[] }
  ? TValue
  : string

/** Input shape for public factories before directed pipeline compatibility is proven. */
export type ICheckedInput = Omit<
  IWebRpcFactoryConfig,
  'protocol' | 'codec' | 'framer' | 'transport' | 'features' | 'middlewares'
> & {
  readonly protocol?: unknown
  readonly codec?: unknown
  readonly framer?: unknown
  readonly transport?: unknown
  readonly middlewares: readonly IWebRpcMiddleware[]
  readonly features?: readonly IWebRpcFeature[]
}

/** Retains explicit default-factory calls while fixing their send boundary to semantic envelopes. */
export type ILegacyDefault<
  TTarget extends string,
  TMiddlewares extends readonly IWebRpcMiddleware[],
  TFeatures extends readonly IWebRpcFeature[]
> = Omit<
  IWebRpcFactoryConfig<TTarget, TMiddlewares, TFeatures>,
  'protocol' | 'codec' | 'framer' | 'transport'
> & {
  readonly protocol?: never
  readonly codec?: never
  readonly framer?: never
  readonly features?: IWebRpcFiniteFeatureTuple<TFeatures>
  readonly transport?: Omit<IWebRpcTransport<unknown>, 'send'> & {
    readonly send: (value: IRpcEnvelope, options?: IWebRpcSendOptions) => void | Promise<void>
  }
}

/** Proves concrete codec-to-framer-to-transport relations without adding runtime ownership. */
export type IChecked<TConfig> =
  IAnyComponent<TConfig> extends true
    ? never
    : [IEnvelope<TConfig>] extends [IEncodeInput<TConfig>]
      ? IEqual<IEncoded<TConfig>, IFrameInput<TConfig>> extends true
        ? [IFrameOutput<TConfig>] extends [ISend<TConfig>]
          ? [IIncoming<TConfig>] extends [IAcceptInput<TConfig>]
            ? IEqual<IAccepted<TConfig>, IDecodeInput<TConfig>> extends true
              ? { readonly features?: IWebRpcFiniteFeatureTuple<IFeatures<TConfig>> }
              : never
            : never
          : never
        : never
      : never
