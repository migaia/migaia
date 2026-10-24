import { createRpcError, RpcCoreErrorCode } from '../errors.js'
import { defineFeature, type IFeature, type IFeatureRecord } from '@migaia/plugin-host'

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
  /** One membership index preserves input order without rescanning earlier feature names. */
  const admittedNames = new Set<string>()
  for (const candidate of names) {
    if (typeof candidate !== 'string' || candidate.length === 0 || admittedNames.has(candidate))
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
    admittedNames.add(candidate)
    featureNames.push(candidate)
    features[candidate] = defineFeature<
      IRpcPortFeatureExpose,
      Record<never, never>,
      IRpcPortFeature
    >((core) => core.featureExpose.getPortFeature(candidate))
  }
  return Object.freeze({
    features: Object.freeze(features),
    createRuntime: () => Object.freeze(new RpcPortFeatureRuntime(featureNames))
  })
}

/** One installed middleware owns its deferred cells independently of other registrations. */
class RpcPortFeatureRuntime implements IRpcPortFeatureRuntime {
  /** Publication mutates only these original registration-local cells. */
  readonly #cells = new Map<string, RpcPortFeatureCell>()
  /** Frozen named outputs are stable before and after the single publication. */
  readonly outputs: Readonly<Record<string, IRpcPortFeature>>
  /** Feature resolution reads only this installation's exact cell outputs. */
  readonly expose: IRpcPortFeatureExpose = Object.freeze({
    getPortFeature: (name: string) => {
      /** A missing declaration must fail before a caller can observe another registration. */
      const cell = this.#cells.get(name)
      if (!cell)
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
      return cell.output
    }
  })

  /** Allocate immutable cell outputs in the original declared Feature order. */
  constructor(names: readonly string[]) {
    /** This dictionary remains the exact frozen output record published to native Features. */
    const outputs: Record<string, IRpcPortFeature> = {}
    for (const name of names) {
      /** Every declared name receives one independently owned publication state. */
      const cell = new RpcPortFeatureCell()
      outputs[name] = cell.output
      this.#cells.set(name, cell)
    }
    this.outputs = Object.freeze(outputs)
  }

  /** Preserve original ordered partial publication and reject a repeated cell write. */
  readonly publish = (ports: Readonly<Record<PropertyKey, unknown>>): void => {
    for (const [name, cell] of this.#cells) {
      if (!Object.hasOwn(ports, name))
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
      cell.publish(ports[name])
    }
  }
}

/** One deferred Feature value can be read only after its original publication. */
class RpcPortFeatureCell {
  /** Undefined is a valid published value, so presence remains a separate state bit. */
  #present = false
  /** Only the first successful publication may write this registration-local value. */
  #value: unknown
  /** Public Feature output exposes no publication authority. */
  readonly output: IRpcPortFeature = Object.freeze({
    get: () => {
      if (!this.#present)
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
      return this.#value
    }
  })

  /** Repeated publication preserves the canonical duplicate-module failure. */
  readonly publish = (next: unknown): void => {
    if (this.#present)
      throw createRpcError(
        RpcCoreErrorCode.capabilityConflict,
        RpcCoreErrorText.endpointModuleDuplicated
      )
    this.#value = next
    this.#present = true
  }
}

/** Reads a resolved port Feature output returned by a PluginHost handle. */
export const readWebRpcPortFeature = <T>(value: unknown): T => {
  if (!value || typeof value !== 'object' || typeof (value as IRpcPortFeature).get !== 'function')
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
  return (value as IRpcPortFeature<T>).get()
}
