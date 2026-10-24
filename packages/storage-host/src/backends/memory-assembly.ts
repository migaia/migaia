import { inspectFeatures } from '@migaia/plugin-host/composition'
import type { IStorageFeatureRecord } from '../types.js'
import type { IBackendChangeControllerFactory } from '../core/change-types.js'
import type { createBackendChangeIterator } from '../core/change-iterator.js'

/** Native memory construction uses only the optional owners explicitly selected as Feature roots. */
export type IMemoryAssembly = {
  readonly controller?: IBackendChangeControllerFactory
  readonly iterator?: typeof createBackendChangeIterator
}
/** Definition identities carry construction metadata; no host or store state is registered. */
const memoryAssemblies = new WeakMap<object, IMemoryAssembly>()
/** Attach optional native construction to an explicitly created memory Feature definition. */
export function registerMemoryAssembly<T extends object>(feature: T, assembly: IMemoryAssembly): T {
  memoryAssemblies.set(feature, assembly)
  return feature
}
/** Read the selected roots before native acquisition, without evaluating optional Feature modules. */
export function readMemoryAssembly(features: IStorageFeatureRecord | undefined): IMemoryAssembly {
  /** Only selected roots contribute; unselected definitions allocate no physical resources. */
  const assembly: {
    controller?: IBackendChangeControllerFactory
    iterator?: typeof createBackendChangeIterator
  } = {}
  for (const feature of inspectFeatures(features ?? {}).ordered) {
    /** Each explicit root contributes its single owning construction function. */
    const selected = memoryAssemblies.get(feature)
    if (selected?.controller !== undefined) assembly.controller = selected.controller
    if (selected?.iterator !== undefined) assembly.iterator = selected.iterator
  }
  return assembly
}
