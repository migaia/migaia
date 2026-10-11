import type { IRemotePluginOptions } from '../remote/plugin.js'
import type { IRemotePluginDefinition } from '../remote/plugin.js'
import { createRemoteBindingDrain } from '../remote/internal/binding-drain.js'
import { assembleRemotePluginDefinition } from '../remote/internal/assemble-plugin.js'
import { createRemoteGenerationHolder, createRemoteRegistration } from '../remote/proxy.js'
import type { IAbortSignal } from '@migaia/lifecycle'

/** Own one adapter binding's real endpoint drain through the existing remote lifecycle mechanism. */
export function createAdapterBindingDrain(...args: Parameters<typeof createRemoteBindingDrain>) {
  return createRemoteBindingDrain(...args)
}

/**
 * Build a user-level remote Plugin over an actual adapter binding without exporting assembly
 * internals.
 */
export function createAdapterPlugin<TUnit, TSpec, TMetadata extends object = object>(
  options: IRemotePluginOptions<TUnit, TSpec>,
  metadata?: TMetadata
): IRemotePluginDefinition & TMetadata {
  return assembleRemotePluginDefinition(options, metadata)
}

/** A complete held registration exposes lifecycle operations without publishing its private holder. */
export type IAdapterRegistration = Readonly<{
  prepare(signal: IAbortSignal, rollbackOnFailure?: boolean): Promise<number>
  plugin<TMetadata extends object = object>(
    metadata?: TMetadata,
    onReleased?: () => Promise<void>
  ): IRemotePluginDefinition & TMetadata
  release(): Promise<void>
}>

/**
 * Hold one registration across prevalidation and Plugin installation, retaining its exact
 * resources.
 */
export function holdAdapterRegistration<TUnit, TSpec>(
  options: IRemotePluginOptions<TUnit, TSpec>
): IAdapterRegistration {
  /** Only this operation constructs and retains the canonical registration and generation holder. */
  const holder = createRemoteGenerationHolder(createRemoteRegistration(options), options.report)
  return Object.freeze({
    /** Prevalidate this same held binding; no prepared holder is accepted from the caller. */
    prepare(signal: IAbortSignal, rollbackOnFailure = false) {
      return holder.prepareInitial(signal, rollbackOnFailure)
    },
    /** Transfer this operation's exact prepared holder into the original Plugin assembly. */
    plugin<TMetadata extends object = object>(
      metadata?: TMetadata,
      onReleased?: () => Promise<void>
    ) {
      return assembleRemotePluginDefinition(options, metadata, {
        preparedHolder: holder,
        onReleased
      })
    },
    /** Release this same holder; its original owner preserves close Promise identity and ordering. */
    release: holder.release
  })
}
