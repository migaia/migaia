/** A named root/dependency map of trusted Feature definitions. */
export type IFeatureRecord = Readonly<Record<string, IFeature<any, any, any>>>

/** Opaque reference to one named feature owned by another plugin definition. */
export type IFeatureReference<
  TOutput extends object,
  TOptional extends boolean = false
> = Readonly<{
  readonly plugin: string
  readonly feature: string
  readonly optional: TOptional
  readonly __output?: TOutput
}>

/** Local feature identity or cross-plugin reference accepted as a factory dependency. */
export type IFeatureDependency = IFeature<any, any, any> | IFeatureReference<object, boolean>

/** Dependency map accepted by one feature factory. */
export type IFeatureDependencyRecord = Readonly<Record<string, IFeatureDependency>>

/** Read-only capability surface available to one synchronous Feature factory. */
export type IFeatureCore<TExpose extends object> = Readonly<{
  readonly featureExpose: TExpose
}>

/** Exact outputs for declared direct dependency aliases. */
export type IFeatureOutputs<TDependencies extends IFeatureDependencyRecord> = Readonly<{
  readonly [K in keyof TDependencies]: TDependencies[K] extends IFeatureReference<
    infer TOutput,
    infer TOptional
  >
    ? TOptional extends true
      ? TOutput | undefined
      : TOutput
    : IFeatureOutput<TDependencies[K]>
}>

/** A trusted synchronous Feature definition with its expose requirement and direct dependencies. */
export type IFeature<
  TExpose extends object,
  TOutput extends object,
  TDependencies extends IFeatureDependencyRecord = Record<never, never>
> = Readonly<{
  /** Type-only metadata; runtime identity is authorized exclusively by defineFeature's WeakMap. */
  readonly __feature: {
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
      : TExpose &
          IFeatureRecordRequiredExpose<{
            readonly [K in keyof TDependencies as TDependencies[K] extends IFeature<any, any, any>
              ? K
              : never]: Extract<TDependencies[K], IFeature<any, any, any>>
          }>
    : never

/** Intersects every selected root's required expose contract. */
export type IFeatureRecordRequiredExpose<TFeatures extends IFeatureRecord> =
  keyof TFeatures extends never
    ? Record<never, never>
    : IUnionToIntersection<IFeatureRequiredExpose<TFeatures[keyof TFeatures]>>

/** Factory contract: construction is synchronous while returned methods may remain asynchronous. */
export type IFeatureFactory<
  TExpose extends object,
  TDependencies extends IFeatureDependencyRecord,
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
