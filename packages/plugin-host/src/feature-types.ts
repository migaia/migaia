/** Opaque Feature identity; only `defineFeature` can construct it. */
export declare const featureBrand: unique symbol

/** A named root/dependency map of trusted Feature definitions. */
export type IFeatureRecord = Readonly<Record<string, IFeature<any, any, any>>>

/** Read-only capability surface available to one synchronous Feature factory. */
export type IFeatureCore<TExpose extends object> = Readonly<{
  readonly featureExpose: TExpose
}>

/** Exact outputs for declared direct dependency aliases. */
export type IFeatureOutputs<TDependencies extends IFeatureRecord> = Readonly<{
  readonly [K in keyof TDependencies]: IFeatureOutput<TDependencies[K]>
}>

/** A trusted synchronous Feature definition with its expose requirement and direct dependencies. */
export type IFeature<
  TExpose extends object,
  TOutput extends object,
  TDependencies extends IFeatureRecord = Record<never, never>
> = Readonly<{
  readonly [featureBrand]: {
    readonly expose: TExpose
    readonly output: TOutput
    readonly dependencies: TDependencies
  }
}>

/** Extracts one Feature's exact factory output. */
export type IFeatureOutput<TFeature> =
  TFeature extends IFeature<any, infer TOutput, any> ? TOutput : never

/** Converts a union of Feature expose requirements into their common intersection. */
type IUnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer TIntersection
) => void
  ? TIntersection
  : never

/** Detects erased `any` metadata so public existential Feature records stay finite. */
type IIsAny<T> = 0 extends 1 & T ? true : false

/** Expose contract required by one Feature and its direct dependency closure. */
export type IFeatureRequiredExpose<TFeature> =
  TFeature extends IFeature<infer TExpose, any, infer TDependencies>
    ? IIsAny<TDependencies> extends true
      ? TExpose
      : TExpose & IFeatureRecordRequiredExpose<TDependencies>
    : never

/** Intersects every selected root's required expose contract. */
export type IFeatureRecordRequiredExpose<TFeatures extends IFeatureRecord> =
  keyof TFeatures extends never
    ? Record<never, never>
    : IUnionToIntersection<IFeatureRequiredExpose<TFeatures[keyof TFeatures]>>

/** Factory contract: construction is synchronous while returned methods may remain asynchronous. */
export type IFeatureFactory<
  TExpose extends object,
  TDependencies extends IFeatureRecord,
  TOutput extends object
> = (
  core: IFeatureCore<TExpose>,
  dependencies: IFeatureOutputs<TDependencies>
) => TOutput & (TOutput extends PromiseLike<unknown> ? never : unknown)

/** Read-only trusted topology projection; factories and dependency metadata remain private. */
export type IFeatureInspection<TFeatures extends IFeatureRecord> = Readonly<{
  readonly roots: TFeatures
  readonly ordered: readonly IFeature<any, any, any>[]
}>
