import { defineFeature, type IFeature, type IFeatureRecord } from '@migaia/plugin-host'
import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'

/** Deferred original port value published by one middleware registration. */
export type IWebRpcPortFeature<T = unknown> = Readonly<{
  get(): T
}>

/** Registration-local exposure used by each named port Feature. */
type IWebRpcPortFeatureExpose = Readonly<{
  getPortFeature(name: string): IWebRpcPortFeature
}>

/** Prepared port Feature set owned by one middleware definition. */
export type IWebRpcPortFeatureSet = Readonly<{
  readonly features: IFeatureRecord
  createRuntime(): IWebRpcPortFeatureRuntime
}>

/** Registration-local cells used by one middleware installation. */
export type IWebRpcPortFeatureRuntime = Readonly<{
  readonly expose: IWebRpcPortFeatureExpose
  readonly outputs: Readonly<Record<string, IWebRpcPortFeature>>
  publish(ports: Readonly<Record<PropertyKey, unknown>>): void
}>

/** Creates one Feature per declared port while keeping publication registration-local. */
export const createWebRpcPortFeatureSet = (
  names: readonly PropertyKey[] = []
): IWebRpcPortFeatureSet => {
  const features: Record<string, IFeature<IWebRpcPortFeatureExpose, IWebRpcPortFeature>> = {}
  const featureNames: string[] = []
  for (const candidate of names) {
    if (typeof candidate !== 'string' || candidate.length === 0 || featureNames.includes(candidate))
      throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
    featureNames.push(candidate)
    features[candidate] = defineFeature<
      IWebRpcPortFeatureExpose,
      Record<never, never>,
      IWebRpcPortFeature
    >((core) => core.featureExpose.getPortFeature(candidate))
  }
  return Object.freeze({
    features: Object.freeze(features),
    createRuntime: () => {
      /** Cells are immutable outputs; only their closure-backed value changes once. */
      const cells = new Map<
        string,
        { readonly output: IWebRpcPortFeature; publish(value: unknown): void }
      >()
      const outputs: Record<string, IWebRpcPortFeature> = {}
      for (const name of featureNames) {
        let present = false
        let value: unknown
        const output = Object.freeze({
          get: () => {
            if (!present)
              throw new WebRpcError(
                WebRpcErrorCode.invalidConfig,
                WebRpcErrorText.endpointModuleInvalid
              )
            return value
          }
        })
        outputs[name] = output
        cells.set(name, {
          output,
          publish: (next) => {
            if (present)
              throw new WebRpcError(
                WebRpcErrorCode.capabilityConflict,
                WebRpcErrorText.endpointModuleDuplicated
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
              throw new WebRpcError(
                WebRpcErrorCode.invalidConfig,
                WebRpcErrorText.endpointModuleInvalid
              )
            return cell.output
          }
        }),
        outputs: Object.freeze(outputs),
        publish: (ports: Readonly<Record<PropertyKey, unknown>>) => {
          for (const [name, cell] of cells) {
            if (!Object.hasOwn(ports, name))
              throw new WebRpcError(
                WebRpcErrorCode.invalidConfig,
                WebRpcErrorText.endpointModuleInvalid
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
  if (
    !value ||
    typeof value !== 'object' ||
    typeof (value as IWebRpcPortFeature).get !== 'function'
  )
    throw new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
  return (value as IWebRpcPortFeature<T>).get()
}
