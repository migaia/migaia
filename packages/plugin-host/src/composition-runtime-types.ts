import type { IScheduler } from '@migaia/utils/scheduler'
import type { PluginHostState } from './host-state.ts'
import type { IPluginConstraint } from './plugin-definition-types.ts'
import type { IPluginDefinition, IRegistration } from './registry.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'
import type { IInstallBatchContext, PluginHostInstallRuntime } from './install-runtime.ts'
import type { PluginHostRemovalRuntime } from './removal-runtime.ts'
import type { IPluginHostDiagnostic } from './host-options-types.ts'

/** Original Host authority captured at construction and acquired by the composition entry on demand. */
export type IPluginHostCompositionRuntimePort<TDomainCore extends object, TValue> = Readonly<{
  readonly host: object
  readonly scheduler: IScheduler
  readonly pipelineDrainTimeoutMs: number | false
  /** Host-owned dependency facts used for one whole-batch removal plan. */
  readonly state: PluginHostState<TDomainCore, TValue>
  readonly assertActive: () => void
  readonly assertMutationAllowed: () => void
  readonly snapshotPlugins: (
    plugins: readonly IPluginConstraint<any>[]
  ) => IPluginDefinition<TDomainCore & IPluginHostCore<TValue>>[]
  readonly enqueue: <T>(task: () => Promise<T>) => Promise<T>
  readonly publish: (
    installed: readonly IRegistration<TDomainCore, TValue>[],
    batch: IInstallBatchContext<TDomainCore, TValue>
  ) => void
  readonly createView: () => unknown
  readonly diagnostic: IPluginHostDiagnostic
  /** Existing installation owner keeps activation and candidate construction together. */
  readonly installation: PluginHostInstallRuntime<TDomainCore, TValue>
  /** Existing removal owner performs cleanup; the Host adds no forwarding layer. */
  readonly removal: PluginHostRemovalRuntime<TDomainCore, TValue>
}>
