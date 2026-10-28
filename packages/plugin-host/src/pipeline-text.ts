/** Owns stable named-pipeline addressing and diagnostic scope text, not lookup or execution policy. */
import type { IPluginDependency } from './dependency-reader.ts'

/** Diagnostic scope labels and the separator shared by declaration qualification and lookup. */
export const PipelineAccessText = {
  /** Top-level lookup describes the Host authority rather than a plugin registration. */
  host: 'Host',
  /** Retained private owners cannot address a different registration generation. */
  currentRegistration: 'current registration only',
  /** Domain-core construction may borrow only its original issued batch. */
  issuedConstructionBatch: 'issued construction batch only',
  /** Qualified names use the same non-escaping dot as the public pipeline contract. */
  separator: '.'
} as const

/** Formats the original plugin-scoped diagnostic label without introducing a new public message. */
export function pipelinePluginScope(name: string): string {
  return `plugin ${name}`
}

/** A Feature label stays more specific than its enclosing plugin; absent registration means Host. */
export function pipelineUnknownScope(pluginName?: string, feature?: string): string {
  return feature
    ? `feature ${pluginName}.${feature}`
    : pluginName === undefined
      ? PipelineAccessText.host
      : pipelinePluginScope(pluginName)
}

/** Preserves original first-reference dependency order in the unknown-name diagnostic. */
export function pipelineInventory(
  host: readonly string[],
  own: readonly string[],
  dependencies: readonly IPluginDependency[]
): string {
  return `host [${host.join(', ')}]; own [${own.join(', ')}]; dependencies [${dependencies.map(({ provider }) => `${provider}.*`).join(', ')}]`
}

/** Qualification is shared by collision admission, group lane labels and provider lookup. */
export function qualifyPipelineName(pluginName: string, name: string): string {
  return `${pluginName}.${name}`
}

/**
 * Splits on the first separator in one pass; missing qualification preserves the original empty
 * parts.
 */
export function splitPipelineAddress(name: string): readonly [string, string] {
  for (let index = 0; index < name.length; index += 1)
    if (name[index] === PipelineAccessText.separator)
      return [name.slice(0, index), name.slice(index + 1)]
  return ['', '']
}
