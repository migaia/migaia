/**
 * Defines explicit pipeline collaboration ports; runner and collection state stay with their
 * owners.
 */
import type { INativeAbortSignal } from '@migaia/utils/promise'
import type { IPendingTracker } from '@migaia/lifecycle'
import type { StageLaneCollection } from './stage-lanes.js'
import type { IPluginHostDiagnostic } from './host-options-types.js'
import type { IDataOrderSlotState } from './composition.js'
import type { IRegistration } from './registry.js'

/** The Host lends existing lifecycle, pending and ordering owners to every pipeline. */
export type IPipelinePorts<TValue> = Readonly<{
  host: object
  signal: INativeAbortSignal
  pending: IPendingTracker
  lanes: StageLaneCollection<TValue>
  slots: Map<string, IDataOrderSlotState>
  allocateSlot(): bigint
  assertActive(): void
  /** Host-owned stage registration advances the original shared publication revision. */
  commit(): void
  /** Committed names remain the sole external publication boundary. */
  /** Reuses the native cleanup descriptor policy after original owner draining. */
  ownCleanup(registration: IRegistration<any, TValue>, cleanup: () => void): void
  registrations: ReadonlyMap<string, IRegistration<any, TValue>>
  diagnostic: IPluginHostDiagnostic
}>

/** Collection authority borrowed by a single runner; it exposes no private collection state. */
export type IPipelineCollectionPort<TDomainCore extends object, TValue> = Readonly<{
  readonly depth: number
  enter(): void
  leave(): void
  isAvailable(registration: IRegistration<TDomainCore, TValue>): boolean
}>
