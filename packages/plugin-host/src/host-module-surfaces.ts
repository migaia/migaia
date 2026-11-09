import type { IRegistration, IPluginDefinition } from './registry.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type {
  IPluginHandle,
  IPluginRemoval,
  IPluginDependencyPlan,
  IPluginDependencyMutationOptions
} from './plugin-handle-types.ts'
/** Core dispatch borrows only the public operation, never the optional runtime class. */
export type IHostActivationOperations = Readonly<{
  activate(name: string): Promise<IPluginHandle<IPluginConstraint<any>>>
}>
/** Replacement and removal remain native transactions behind the feature dependency surface. */
export type IHostFeatureOperations = Readonly<{
  replace<TPlugin extends IPluginConstraint<any>>(
    name: string,
    next: TPlugin
  ): Promise<IPluginHandle<TPlugin>>
  remove(
    name: string,
    options: IPluginDependencyMutationOptions
  ): Promise<IPluginRemoval | IPluginDependencyPlan>
}>
/** Shared registration visibility remains in core; optional enablement owns disabled tokens/hooks. */
export type IHostEnablementOperations<TDomainCore extends object, TValue> = Readonly<{
  disable(registration: IRegistration<TDomainCore, TValue>): boolean
  forget(name: string): void
  notifyInstalled(registration: IRegistration<TDomainCore, TValue>): void
}>
/** Only feature-dependent operations call candidate replacement after module installation. */
export type IHostReplaceOperations<TDomainCore extends object, TValue> = Readonly<{
  replace(
    previous: IRegistration<TDomainCore, TValue>,
    definition: IPluginDefinition<any>
  ): Promise<void>
}>
/**
 * Core use/install can trigger recovery without importing the planner or inspecting its private
 * state.
 */
export type IHostResumeOperations = Readonly<{
  resumeAfterProvider(provider: string, generationChanged: boolean): Promise<void>
  planAfterProvider(
    provider: string,
    generationChanged: boolean
  ): Readonly<{ steps: readonly unknown[] }>
}>
