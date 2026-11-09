import type { IPluginHostRuntimeContext } from './host-runtime-context.ts'
import type { PluginHostRuntimePorts } from './host-runtime-ports.ts'
import type { IPluginHostOptions } from './host-options-types.ts'
import type { IPluginDefinition } from './registry.ts'
import { PluginHostError, identifyPluginHostCallbackFailure } from './errors.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
import { PLUGIN_HOST_SOURCE } from './error-code.ts'
import ERROR_TEXT from './error-text.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { HostModuleText } from './module-constants.ts'
import { MiddlewarePipelineMode } from '@migaia/middleware-pipeline'
/** Public opaque identity; installed surfaces are expressed separately by the host type. */
export declare const moduleIdentity: unique symbol
/** Literal keys retain module selection while the private brand rejects structural fabrication. */
export type IHostModule<TKey extends string = string> = Readonly<{
  readonly key: TKey
  readonly [moduleIdentity]: true
}>
/**
 * Built-in modules borrow canonical internals through the canonical internal boundary; core calls
 * only this extension point.
 */
export type IHostModuleDefinition<TKey extends string = string> = Readonly<{
  key: TKey
  requires?: readonly string[]
  install(
    context: IPluginHostRuntimeContext<any, any, any, any>,
    port: PluginHostRuntimePorts<any, any, any, any>,
    options: IPluginHostOptions
  ): Readonly<{ dispose?(): void | Promise<void> }> | void
}>
/** The package's sole module identity authority; structural copies have no implementation. */
const definitions = new WeakMap<object, IHostModuleDefinition>()
/** Internal definition entry; neither this function nor its port is exported publicly. */
export function defineModule<const TKey extends string>(
  definition: IHostModuleDefinition<TKey>
): IHostModule<TKey> {
  /** Public identity exposes its stable key without exposing installation authority. */
  const module = Object.freeze({ key: definition.key })
  definitions.set(module, definition)
  return module as IHostModule<TKey>
}
/** One host owns admitted modules and their successful construction order. */
export class HostModules {
  /** Immutable definitions are indexed once before any install can run. */
  readonly #definitions = new Map<string, IHostModuleDefinition>()
  /** Dependency order preserves declaration order among ready modules. */
  readonly #order: IHostModuleDefinition[] = []
  /** Runtime cleanup belongs to the host that installed it, never the module identity. */
  readonly #runtimes: Readonly<{ dispose?(): void | Promise<void> }>[] = []
  /** Reject invalid identities and dependency sets before constructing any module. */
  constructor(modules: readonly IHostModule[] = []) {
    if (!Array.isArray(modules))
      throw new PluginHostError(PluginHostErrorCode.invalidHostModule, HostModuleText.invalid)
    for (const module of modules) {
      /** Only the private registry can supply an installation implementation. */
      const definition = definitions.get(module)
      if (!definition)
        throw new PluginHostError(PluginHostErrorCode.invalidHostModule, HostModuleText.invalid)
      if (this.#definitions.has(definition.key))
        throw new PluginHostError(PluginHostErrorCode.duplicateHostModule, HostModuleText.duplicate)
      this.#definitions.set(definition.key, definition)
    }
    /** Remaining incoming edges and successor lists permit one linear Kahn traversal. */
    const remaining = new Map<string, number>()
    /** Successors are indexed once rather than rescanning modules after each predecessor. */
    const successors = new Map<string, string[]>()
    /** Ready cursor preserves the input order of independent modules. */
    const ready: string[] = []
    for (const [key, definition] of this.#definitions) {
      remaining.set(key, definition.requires?.length ?? 0)
      if (!definition.requires?.length) ready.push(key)
      for (const requirement of definition.requires ?? []) {
        if (!this.#definitions.has(requirement))
          throw new PluginHostError(PluginHostErrorCode.hostModuleMissing, HostModuleText.missing, {
            detail: { module: requirement, requiredBy: key }
          })
        /** Reverse edges wake successors without rescanning the module collection. */
        let targets = successors.get(requirement)
        if (!targets) successors.set(requirement, (targets = []))
        targets.push(key)
      }
    }
    for (let cursor = 0; cursor < ready.length; cursor += 1) {
      /** Each admitted ready identity is consumed once by the cursor traversal. */
      const key = ready[cursor]!
      this.#order.push(this.#definitions.get(key)!)
      for (const successor of successors.get(key) ?? []) {
        /** A successor becomes ready after its final declared predecessor is processed. */
        const count = remaining.get(successor)! - 1
        remaining.set(successor, count)
        if (count === 0) ready.push(successor)
      }
    }
    if (this.#order.length !== this.#definitions.size)
      throw new PluginHostError(PluginHostErrorCode.hostModuleMissing, HostModuleText.missing)
  }
  /** Class dispatch and frozen handle construction query the same admitted set. */
  has(key: string): boolean {
    return this.#definitions.has(key)
  }
  /** Missing capabilities and declared modes fail before acquisition; mode identities are borrowed. */
  assertDefinitions(
    plugins: readonly IPluginDefinition<any>[],
    modes: ReadonlyMap<string, unknown>
  ): void {
    for (const plugin of plugins) {
      /** Snapshots retain original field presence separately from normalized empty records. */
      const claims = plugin.claimed
      for (const [key, field] of claims ?? [])
        if (!this.has(key))
          throw new PluginHostError(PluginHostErrorCode.hostModuleMissing, HostModuleText.missing, {
            detail: { module: key, plugin: plugin.name, field }
          })
      if (!plugin.pipelines) continue
      for (const [name, spec] of Object.entries(plugin.pipelines)) {
        /** Captured declarations have already passed structural and mode-value admission. */
        const mode = spec.mode ?? MiddlewarePipelineMode.sync
        if (!modes.has(mode))
          throw new PluginHostError(
            PluginHostErrorCode.pipelineModeNotInstalled,
            HostModuleText.pipeline,
            {
              detail: { plugin: plugin.name, pipeline: name, mode }
            }
          )
      }
    }
  }
  /** Installs only admitted extensions; canonical owners stay in the supplied host context. */
  install(
    context: IPluginHostRuntimeContext<any, any, any, any>,
    port: PluginHostRuntimePorts<any, any, any, any>,
    options: IPluginHostOptions
  ): void {
    try {
      for (const definition of this.#order) {
        /** Successful installations alone can contribute a runtime cleanup receipt. */
        const runtime = definition.install(context, port, options)
        if (runtime) this.#runtimes.push(runtime)
      }
    } catch (error) {
      /** Construction is synchronous; synchronous rollback errors retain the primary failure first. */
      const errors: unknown[] = [identifyPluginHostCallbackFailure(error)]
      for (let index = this.#runtimes.length - 1; index >= 0; index -= 1) {
        try {
          this.#runtimes[index]!.dispose?.()
        } catch (cleanup) {
          errors.push(cleanup)
        }
      }
      this.#runtimes.length = 0
      if (errors.length > 1)
        throw attachErrorIdentity(new AggregateError(errors, ERROR_TEXT.CALLBACK_FAILED), {
          source: PLUGIN_HOST_SOURCE,
          code: PluginHostErrorCode.callbackFailed
        })
      throw errors[0]
    }
  }
  /** Module state closes after plugin resources, in reverse successful installation order. */
  async dispose(): Promise<void> {
    for (let index = this.#runtimes.length - 1; index >= 0; index -= 1)
      await this.#runtimes[index]!.dispose?.()
  }
}
