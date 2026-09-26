import {
  defineFeature as defineNativeFeature,
  type IFeature,
  type IFeatureFactory,
  type IFeatureRecord
} from '@migaia/plugin-host'
import { createInvalidFeatureError, registerFeaturePolicy } from './internal/feature-policy.js'

/** Native opaque Feature used by WebRPC endpoint composition. */
export type IRpcFeature<
  TSurface extends object = object,
  TDependencies extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = IFeature<TExpose, TSurface, TDependencies>

/** Exact endpoint surface projected from selected native Feature roots. */
export type IRpcFeatureSurface<TFeatures extends readonly IRpcFeature[]> = IUnionToIntersection<
  TFeatures[number] extends IRpcFeature<infer TSurface> ? TSurface : never
>

/** Rejects widened arrays at endpoint composition boundaries. */
export type IRpcFiniteFeatureTuple<TFeatures extends readonly IRpcFeature[]> =
  number extends TFeatures['length'] ? never : TFeatures

/** Static advanced form preserves precise expose and dependency contracts without exposing a kind. */
export type IRpcFeatureDefinition<
  TSurface extends object = object,
  TDependencies extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
> = Readonly<{
  readonly install: IFeatureFactory<TExpose, TDependencies, TSurface>
  readonly dependencies?: TDependencies
  readonly publicKeys?: readonly (keyof TSurface & string)[]
  readonly conflicts?: readonly string[]
}>

/**
 * Defines a synchronous native Feature with optional direct native Feature dependencies.
 *
 * @remarks
 *   This overload has no endpoint policy object; callers publish only through Feature output.
 * @typeParam TSurface - Public capability surface returned by the Feature installation.
 * @typeParam TDependencies - Direct native Feature dependency record available only to the factory.
 * @typeParam TExpose - Host-owned FeatureExpose bridge required by the factory.
 * @param install - Synchronous capability factory evaluated by PluginHost during construction.
 * @param dependencies - Optional direct native Feature dependencies retained as private edges.
 * @returns An immutable Feature token accepted by `config.features` or a first-party root record.
 * @throws {RpcError} When the factory is not a callable native Feature definition.
 */
export function defineFeature<
  TSurface extends object = object,
  const TDependencies extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
>(
  install: IFeatureFactory<TExpose, TDependencies, TSurface>,
  dependencies?: TDependencies
): IRpcFeature<TSurface, TDependencies, TExpose>
/**
 * Defines a synchronous native Feature with immutable WebRPC endpoint publication policy.
 *
 * @remarks
 *   Policy is data-only; PluginHost remains the lifecycle and identity owner.
 * @typeParam TSurface - Public capability surface returned by the Feature installation.
 * @typeParam TDependencies - Direct native Feature dependency record available only to the factory.
 * @typeParam TExpose - Host-owned FeatureExpose bridge required by the factory.
 * @param definition - Factory, dependencies, and stable publication policy captured before setup.
 * @returns An immutable Feature token accepted by `config.features` or a first-party root record.
 * @throws {RpcError} When the definition has no callable native Feature factory.
 */
export function defineFeature<
  TSurface extends object = object,
  const TDependencies extends IFeatureRecord = Record<never, never>,
  TExpose extends object = Record<never, never>
>(
  definition: IRpcFeatureDefinition<TSurface, TDependencies, TExpose>
): IRpcFeature<TSurface, TDependencies, TExpose>
export function defineFeature(input: unknown, dependencies?: object): IRpcFeature {
  const definition =
    typeof input === 'function'
      ? undefined
      : (input as IRpcFeatureDefinition<object, IFeatureRecord, object> | undefined)
  const install = typeof input === 'function' ? input : definition?.install
  if (typeof install !== 'function') throw createInvalidFeatureError()
  const feature = defineNativeFeature(
    install as IFeatureFactory<Record<never, never>, IFeatureRecord, object>,
    (definition?.dependencies ?? dependencies) as IFeatureRecord | undefined
  )
  registerFeaturePolicy(feature, definition ?? {})
  return feature
}

/** Intersects selected root output surfaces without retaining a runtime feature registry. */
type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer I
) => void
  ? I
  : never
