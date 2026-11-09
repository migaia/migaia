import { readDefinedFeature } from './feature-definition-snapshots.ts'
import { HostModuleKey } from './module-constants.ts'
import { PluginDefinitionKey } from './definition-constants.ts'
import { PluginActivation } from './state-constants.ts'
/** The captured field subset is shared by trusted definitions and raw admission. */
type IClaimFields = Readonly<{
  features: unknown
  onDependencyReplaced: unknown
  onEnable: unknown
  onDisable: unknown
  activation: unknown
  pipelines: unknown
}>
/** Omitted capability fields share private empty metadata without per-definition allocation. */
const emptyModuleClaims: readonly (readonly [string, string])[] = Object.freeze([])
/** Record field presence without another caller-property read or a module implementation import. */
export function snapshotModuleClaims(
  fields: IClaimFields,
  roots?: Readonly<Record<string, object>>
): readonly (readonly [string, string])[] {
  /** Roots come from the same captured features field, so omitted features have no dependencies. */
  if (
    fields.features === undefined &&
    fields.onDependencyReplaced === undefined &&
    fields.onEnable === undefined &&
    fields.onDisable === undefined &&
    fields.activation !== PluginActivation.lazy &&
    fields.pipelines === undefined
  )
    return emptyModuleClaims
  /** Root metadata is already captured and validated; no caller getter is read again. */
  let hasDependencies = false
  for (const feature of Object.values(roots ?? {})) {
    if (Object.keys(readDefinedFeature(feature)?.dependencies ?? {}).length > 0) {
      hasDependencies = true
      break
    }
  }
  /** Only present claims allocate tuples; omitted capabilities need no temporary arrays. */
  const claims: (readonly [string, string])[] = []
  if (hasDependencies)
    claims.push([HostModuleKey.featureDependencies, PluginDefinitionKey.features])
  if (fields.features !== undefined)
    claims.push([HostModuleKey.features, PluginDefinitionKey.features])
  if (fields.onDependencyReplaced !== undefined)
    claims.push([HostModuleKey.featureDependencies, PluginDefinitionKey.onDependencyReplaced])
  if (fields.onEnable !== undefined)
    claims.push([HostModuleKey.enablement, PluginDefinitionKey.onEnable])
  if (fields.onDisable !== undefined)
    claims.push([HostModuleKey.enablement, PluginDefinitionKey.onDisable])
  if (fields.activation === PluginActivation.lazy)
    claims.push([HostModuleKey.activation, PluginDefinitionKey.activation])
  if (fields.pipelines !== undefined)
    claims.push([HostModuleKey.namedPipelines, PluginDefinitionKey.pipelines])
  return Object.freeze(claims)
}
