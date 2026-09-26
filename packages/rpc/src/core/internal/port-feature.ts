import { defineFeature, type IFeature, type IFeatureRecord } from '@migaia/plugin-host'
import { RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'

/** Deferred original port value published by one middleware registration. */
export type IRpcPortFeature<T = unknown> = Readonly<{
  get(): T
}>

/** Registration-local exposure used by each named port Feature. */
type IRpcPortFeatureExpose = Readonly<{
  getPortFeature(name: string): IRpcPortFeature
}>

/** Prepared port Feature set owned by one middleware definition. */
export type IRpcPortFeatureSet = Readonly<{
  readonly features: IFeatureRecord
  createRuntime(): IRpcPortFeatureRuntime
}>

/** Registration-local cells used by one middleware installation. */
export type IRpcPortFeatureRuntime = Readonly<{
  readonly expose: IRpcPortFeatureExpose
  readonly outputs: Readonly<Record<string, IRpcPortFeature>>
  publish(ports: Readonly<Record<PropertyKey, unknown>>): void
}>

/** Creates one Feature per declared port while keeping publication registration-local. */
export const createWebRpcPortFeatureSet = (
  names: readonly PropertyKey[] = []
): IRpcPortFeatureSet => {
  const features: Record<string, IFeature<IRpcPortFeatureExpose, IRpcPortFeature>> = {}
  const featureNames: string[] = []
  for (const candidate of names) {
    if (typeof candidate !== 'string' || candidate.length === 0 || featureNames.includes(candidate))
      throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
    featureNames.push(candidate)
    features[candidate] = defineFeature<
      IRpcPortFeatureExpose,
      Record<never, never>,
      IRpcPortFeature
    >((core) => core.featureExpose.getPortFeature(candidate))
  }
  return Object.freeze({
    features: Object.freeze(features),
    createRuntime: () => {
      /** Cells are immutable outputs; only their closure-backed value changes once. */
      const cells = new Map<
        string,
        { readonly output: IRpcPortFeature; publish(value: unknown): void }
      >()
      const outputs: Record<string, IRpcPortFeature> = {}
      for (const name of featureNames) {
        let present = false
        let value: unknown
        const output = Object.freeze({
          get: () => {
            if (!present)
              throw new RpcError(
                RpcCoreErrorCode.invalidConfig,
                RpcCoreErrorText.endpointModuleInvalid
              )
            return value
          }
        })
        outputs[name] = output
        cells.set(name, {
          output,
          publish: (next) => {
            if (present)
              throw new RpcError(
                RpcCoreErrorCode.capabilityConflict,
                RpcCoreErrorText.endpointModuleDuplicated
              )
            value = next
            present = true
          }
        })
      }
      return Object.freeze({
        expose: Object.freeze({
          getPortFeature: (name: string) => {
            const cell = cells.get(name)
            if (!cell)
              throw new RpcError(
                RpcCoreErrorCode.invalidConfig,
                RpcCoreErrorText.endpointModuleInvalid
              )
            return cell.output
          }
        }),
        outputs: Object.freeze(outputs),
        publish: (ports: Readonly<Record<PropertyKey, unknown>>) => {
          for (const [name, cell] of cells) {
            if (!Object.hasOwn(ports, name))
              throw new RpcError(
                RpcCoreErrorCode.invalidConfig,
                RpcCoreErrorText.endpointModuleInvalid
              )
            cell.publish(ports[name])
          }
        }
      })
    }
  })
}

/** Reads a resolved port Feature output returned by a PluginHost handle. */
export const readWebRpcPortFeature = <T>(value: unknown): T => {
  if (!value || typeof value !== 'object' || typeof (value as IRpcPortFeature).get !== 'function')
    throw new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
  return (value as IRpcPortFeature<T>).get()
}
