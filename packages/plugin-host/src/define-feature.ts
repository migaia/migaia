import ERROR_TEXT, { createPluginHostTypeError } from './error-text.js'
import type { IFeature, IFeatureFactory, IFeatureRecord } from './feature-types.js'

/** Module-private immutable definition data; runtime consumers never trust public object shape. */
type IFeatureDefinition = Readonly<{
  readonly factory: Function
  readonly dependencies: Readonly<Record<string, object>>
}>

/** Object shorthand shares the function form's trusted definition snapshot. */
export type IFeatureDescriptor<
  TExpose extends object,
  TDependencies extends IFeatureRecord,
  TOutput extends object
> = Readonly<{
  readonly install: IFeatureFactory<TExpose, TDependencies, TOutput>
  readonly dependencies?: TDependencies
}>

/** Trusted identity store for Feature definitions. */
const definitions = new WeakMap<object, IFeatureDefinition>()

/** Captures one direct dependency record before any Feature factory can run. */
export const snapshotFeatureRecord = (value: unknown): Readonly<Record<string, object>> => {
  if (value === undefined) return Object.freeze({})
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    throw createPluginHostTypeError(ERROR_TEXT.FEATURE_DEPENDENCIES_RECORD)
  const snapshot: Record<string, object> = Object.create(null)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string')
      throw createPluginHostTypeError(ERROR_TEXT.FEATURE_DEPENDENCIES_DATA)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      throw createPluginHostTypeError(ERROR_TEXT.FEATURE_DEPENDENCIES_DATA)
    if (!readDefinedFeature(descriptor.value))
      throw createPluginHostTypeError(ERROR_TEXT.FEATURE_DEPENDENCIES_DEFINED)
    snapshot[key] = descriptor.value as object
  }
  return Object.freeze(snapshot)
}

/** Defines a synchronous, opaque Feature without evaluating user factory code. */
export function defineFeature<
  TExpose extends object = Record<never, never>,
  const TDependencies extends IFeatureRecord = Record<never, never>,
  TOutput extends object = Record<never, never>
>(
  factory: IFeatureFactory<TExpose, TDependencies, TOutput>,
  dependencies?: TDependencies
): IFeature<TExpose, TOutput, TDependencies>
export function defineFeature<
  TExpose extends object = Record<never, never>,
  const TDependencies extends IFeatureRecord = Record<never, never>,
  TOutput extends object = Record<never, never>
>(
  descriptor: IFeatureDescriptor<TExpose, TDependencies, TOutput>
): IFeature<TExpose, TOutput, TDependencies>
export function defineFeature(
  input: Function | Readonly<{ readonly install: Function; readonly dependencies?: object }>,
  dependencies?: object
): IFeature<any, any, any> {
  const descriptor = typeof input === 'function' ? undefined : input
  const installDescriptor = descriptor && Object.getOwnPropertyDescriptor(descriptor, 'install')
  const dependenciesDescriptor =
    descriptor && Object.getOwnPropertyDescriptor(descriptor, 'dependencies')
  if (
    descriptor &&
    (!installDescriptor ||
      !('value' in installDescriptor) ||
      (dependenciesDescriptor && !('value' in dependenciesDescriptor)))
  )
    throw createPluginHostTypeError(ERROR_TEXT.FEATURE_FACTORY_REQUIRED)
  const factory = typeof input === 'function' ? input : installDescriptor?.value
  if (typeof factory !== 'function')
    throw createPluginHostTypeError(ERROR_TEXT.FEATURE_FACTORY_REQUIRED)
  const feature = Object.freeze({}) as IFeature<any, any, any>
  definitions.set(
    feature,
    Object.freeze({
      factory,
      dependencies: snapshotFeatureRecord(dependenciesDescriptor?.value ?? dependencies)
    })
  )
  return feature
}

/** Returns only package-authored Feature definition data for a trusted opaque identity. */
export const readDefinedFeature = (value: unknown): IFeatureDefinition | undefined =>
  definitions.get(value as object)
