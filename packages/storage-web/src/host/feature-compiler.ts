import { buildCapabilityTopology, type ITopologyNode } from '@migaia/capability/graph/topology'
import { StorageError, StorageErrorCode } from '../types/errors.js'
import { StorageErrorText } from '../error-text.js'
import { readStorageBackendFeatureMetadata, readStorageBackendPluginMetadata } from './contracts.js'
import { STORAGE_LIVE_QUERY_SERVICE_NAME } from './names.js'
import type {
  IStorageBackendPluginHandle,
  IStorageFeatureCompilation,
  IStorageFeatureNode
} from './types.js'

/** A pure input envelope for one backend's feature graph. */
export type IStorageFeatureCompilerInput = {
  readonly installedProviderIds: readonly string[]
  readonly plugins: readonly IStorageBackendPluginHandle[]
}

/** Converts a topology callback into one stable storage-web coded admission error. */
const throwTopologyError = (): never => {
  throw new StorageError(
    StorageErrorCode.reactiveTopologyInvalid,
    {},
    StorageErrorText.reactiveTopologyInvalid
  )
}

/** Compiles external providers and the current batch before any PluginHost mutation. */
export const compileStorageFeatureTopology = (
  input: IStorageFeatureCompilerInput
): IStorageFeatureCompilation => {
  const providerSnapshot = Array.from(input.installedProviderIds)
  const needsReactiveService = input.plugins.some((plugin) =>
    readStorageBackendPluginMetadata(plugin)?.features.some(
      (feature) => readStorageBackendFeatureMetadata(feature)?.capability === 'reactive'
    )
  )
  if (needsReactiveService && !providerSnapshot.includes(STORAGE_LIVE_QUERY_SERVICE_NAME))
    providerSnapshot.push(STORAGE_LIVE_QUERY_SERVICE_NAME)
  providerSnapshot.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
  const seenProviders = new Set<string>()
  for (const provider of providerSnapshot) {
    if (seenProviders.has(provider)) throwTopologyError()
    seenProviders.add(provider)
  }
  const external: IStorageFeatureNode[] = providerSnapshot.map((id, ordinal) => ({
    id,
    dependencies: [],
    ordinal,
    materialize: false
  }))
  const real: IStorageFeatureNode[] = []
  const seenNodes = new Set<string>(seenProviders)
  let ordinal = external.length
  for (const plugin of input.plugins) {
    const pluginMetadata = readStorageBackendPluginMetadata(plugin)
    if (pluginMetadata === undefined) {
      throw new StorageError(
        StorageErrorCode.reactiveTopologyInvalid,
        {},
        StorageErrorText.reactiveTopologyInvalid
      )
    }
    if (seenNodes.has(plugin.id)) throwTopologyError()
    seenNodes.add(plugin.id)
    real.push({
      id: plugin.id,
      dependencies: [],
      ordinal: ordinal++,
      materialize: true
    })
    const pluginFeatures = pluginMetadata.features
    for (const feature of pluginFeatures) {
      const featureMetadata = readStorageBackendFeatureMetadata(feature)
      if (featureMetadata === undefined) {
        throw new StorageError(
          StorageErrorCode.reactiveTopologyInvalid,
          {},
          StorageErrorText.reactiveTopologyInvalid
        )
      }
      const id = `${plugin.id}:${featureMetadata.capability}`
      if (seenNodes.has(id)) throwTopologyError()
      seenNodes.add(id)
      real.push({
        id,
        dependencies:
          featureMetadata.capability === 'reactive'
            ? [
                { provider: plugin.id, required: true },
                { provider: STORAGE_LIVE_QUERY_SERVICE_NAME, required: true }
              ]
            : [{ provider: plugin.id, required: true }],
        ordinal: ordinal++,
        materialize: true,
        feature: {
          backendKind: featureMetadata.backendKind as never,
          capability: featureMetadata.capability,
          reactive: featureMetadata.reactive
        }
      })
    }
  }
  const envelopes = [...external, ...real]
  const topologyNodes: readonly ITopologyNode[] = envelopes.map(
    ({ id, dependencies, ordinal: nodeOrdinal }) => ({
      id,
      dependencies,
      ordinal: nodeOrdinal
    })
  )
  const topology = buildCapabilityTopology(
    topologyNodes,
    () => throwTopologyError(),
    () => throwTopologyError(),
    () => throwTopologyError()
  )
  const byId = new Map(envelopes.map((node) => [node.id, node]))
  const ordered = topology.ordered
    .map((node) => byId.get(node.id)!)
    .map((node) => Object.freeze(node))
  return Object.freeze({
    ordered: Object.freeze(ordered),
    materialized: Object.freeze(ordered.filter((node) => node.materialize))
  })
}
